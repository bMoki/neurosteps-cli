import { mkdirSync } from "fs";
import { join } from "path";
import { WORKTREES_DIR } from "./config";
import { pathExists } from "./filesystem";
import { NS_CONFIG_DIR } from "./settings";
import { exec } from "./shell";

export const STALE_BRANCH_DAYS = 7;
export const STALE_BRANCH_FLAG = "stale";

const STALE_BRANCH_MS = STALE_BRANCH_DAYS * 24 * 60 * 60 * 1000;
const BRANCH_SCAN_CONCURRENCY = 8;
const BRANCH_ACTIVITY_FILE = join(NS_CONFIG_DIR, "branch-activity.json");
const WORKTREE_REPOS = ["backend", "frontend", "manager", "report-server"];

export interface BranchActivityEntry {
  lastCliUsedAt: string;
  source: string;
}

export type BranchActivity = Record<string, BranchActivityEntry>;

export interface BranchFlagInfo {
  flags: string[];
  stale: boolean;
  lastCommitAt: string | null;
  lastCliUsedAt: string | null;
}

export interface BranchStaleInput {
  lastCommitAt: Date | null;
  lastCliUsedAt: Date | null;
}

export function isBranchStale(input: BranchStaleInput, now = new Date()): boolean {
  if (!input.lastCommitAt) return false;

  const cutoff = now.getTime() - STALE_BRANCH_MS;
  const lastCommitMs = input.lastCommitAt.getTime();
  const lastCliUsedMs = input.lastCliUsedAt?.getTime();

  return lastCommitMs < cutoff && (lastCliUsedMs === undefined || lastCliUsedMs < cutoff);
}

export async function readBranchActivity(): Promise<BranchActivity> {
  try {
    const file = Bun.file(BRANCH_ACTIVITY_FILE);
    if (await file.exists()) {
      return JSON.parse(await file.text()) as BranchActivity;
    }
  } catch {
    // Ignore malformed activity files; status should keep working.
  }
  return {};
}

export async function markBranchTouched(branch: string, source: string): Promise<void> {
  const activity = await readBranchActivity();
  activity[branch] = {
    lastCliUsedAt: new Date().toISOString(),
    source,
  };

  mkdirSync(NS_CONFIG_DIR, { recursive: true });
  await Bun.write(BRANCH_ACTIVITY_FILE, JSON.stringify(activity, null, 2));
}

export async function getBranchFlags(branch: string, now = new Date()): Promise<BranchFlagInfo> {
  return buildBranchFlags(branch, await readBranchActivity(), now);
}

/**
 * Mesma leitura de `getBranchFlags` para várias branches: a atividade é lida uma vez
 * e as branches são varridas em paralelo — cada uma custa até 4 `git log`.
 */
export async function getBranchFlagsMany(
  branches: string[],
  now = new Date(),
): Promise<Map<string, BranchFlagInfo>> {
  const activity = await readBranchActivity();
  const infos = await mapLimited(
    branches,
    BRANCH_SCAN_CONCURRENCY,
    (branch) => buildBranchFlags(branch, activity, now),
  );
  return new Map(branches.map((branch, index) => [branch, infos[index]!]));
}

export async function listFlaggedBranches(branches: string[], flag = STALE_BRANCH_FLAG): Promise<string[]> {
  const infos = await getBranchFlagsMany(branches);
  return branches.filter((branch) => infos.get(branch)?.flags.includes(flag));
}

async function buildBranchFlags(
  branch: string,
  activity: BranchActivity,
  now: Date,
): Promise<BranchFlagInfo> {
  const lastCommitAt = await getLatestBranchCommitAt(branch);
  const lastCliUsedAt = parseDate(activity[branch]?.lastCliUsedAt);
  const stale = isBranchStale({ lastCommitAt, lastCliUsedAt }, now);

  return {
    flags: stale ? [STALE_BRANCH_FLAG] : [],
    stale,
    lastCommitAt: lastCommitAt?.toISOString() ?? null,
    lastCliUsedAt: lastCliUsedAt?.toISOString() ?? null,
  };
}

async function getLatestBranchCommitAt(branch: string): Promise<Date | null> {
  const repoPaths = WORKTREE_REPOS
    .map((repoName) => join(WORKTREES_DIR, branch, repoName))
    .filter((worktreePath) => pathExists(worktreePath));

  const commits = await Promise.all(repoPaths.map(getLastCommitAt));

  let latest: Date | null = null;
  for (const commitAt of commits) {
    if (commitAt && (!latest || commitAt > latest)) {
      latest = commitAt;
    }
  }
  return latest;
}

async function getLastCommitAt(repoPath: string): Promise<Date | null> {
  try {
    const result = await exec(["git", "-C", repoPath, "log", "-1", "--format=%ct"], { silent: true });
    if (result.exitCode !== 0) return null;

    const seconds = Number(result.stdout.trim());
    if (!Number.isFinite(seconds) || seconds <= 0) return null;
    return new Date(seconds * 1000);
  } catch {
    return null;
  }
}

/** Worker pool: mantém `limit` processos git no ar sem disparar um por branch de uma vez. */
async function mapLimited<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index]!);
    }
  });

  await Promise.all(workers);
  return results;
}

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
