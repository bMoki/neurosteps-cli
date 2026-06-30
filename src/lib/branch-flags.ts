import { mkdirSync } from "fs";
import { join } from "path";
import { WORKTREES_DIR } from "./config";
import { pathExists } from "./filesystem";
import { NS_CONFIG_DIR } from "./settings";
import { execSync } from "./shell";

export const STALE_BRANCH_DAYS = 7;
export const STALE_BRANCH_FLAG = "stale";

const STALE_BRANCH_MS = STALE_BRANCH_DAYS * 24 * 60 * 60 * 1000;
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
  const activity = await readBranchActivity();
  const lastCommitAt = getLatestBranchCommitAt(branch);
  const lastCliUsedAt = parseDate(activity[branch]?.lastCliUsedAt);
  const stale = isBranchStale({ lastCommitAt, lastCliUsedAt }, now);

  return {
    flags: stale ? [STALE_BRANCH_FLAG] : [],
    stale,
    lastCommitAt: lastCommitAt?.toISOString() ?? null,
    lastCliUsedAt: lastCliUsedAt?.toISOString() ?? null,
  };
}

export async function listFlaggedBranches(branches: string[], flag = STALE_BRANCH_FLAG): Promise<string[]> {
  const flagged: string[] = [];
  for (const branch of branches) {
    const info = await getBranchFlags(branch);
    if (info.flags.includes(flag)) flagged.push(branch);
  }
  return flagged;
}

function getLatestBranchCommitAt(branch: string): Date | null {
  let latest: Date | null = null;

  for (const repoName of WORKTREE_REPOS) {
    const worktreePath = join(WORKTREES_DIR, branch, repoName);
    if (!pathExists(worktreePath)) continue;

    const commitAt = getLastCommitAt(worktreePath);
    if (commitAt && (!latest || commitAt > latest)) {
      latest = commitAt;
    }
  }

  return latest;
}

function getLastCommitAt(repoPath: string): Date | null {
  try {
    const result = execSync(["git", "-C", repoPath, "log", "-1", "--format=%ct"], { silent: true });
    if (result.exitCode !== 0) return null;

    const seconds = Number(result.stdout.trim());
    if (!Number.isFinite(seconds) || seconds <= 0) return null;
    return new Date(seconds * 1000);
  } catch {
    return null;
  }
}

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
