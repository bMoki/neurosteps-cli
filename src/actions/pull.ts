import { select } from "@inquirer/prompts";
import { join, relative, sep } from "path";
import { WORKTREES_DIR, branchExists, listBranches } from "../lib/config";
import { pathExists } from "../lib/filesystem";
import { colors, emptyLine, section, spinner } from "../lib/logger";
import { assertInteractiveInput } from "../lib/prompt";
import { exec, type ShellResult } from "../lib/shell";

export const DEFAULT_BRANCH_ALIAS = "@default";
const DEFAULT_BRANCH_FALLBACKS = ["main", "master"];
const PULL_REPOS = ["backend", "frontend", "manager", "report-server", "docs"];

export type PullStatus = "updated" | "up-to-date" | "skipped" | "failed";

export interface PullRepoResult {
  repo: string;
  path: string;
  branch?: string;
  status: PullStatus;
  message?: string;
}

export interface PullActionDeps {
  exec: typeof exec;
  cwd: () => string;
  listBranches: typeof listBranches;
  branchExists: typeof branchExists;
  pathExists: typeof pathExists;
  promptBranch: (branches: string[]) => Promise<string>;
}

const defaultDeps: PullActionDeps = {
  exec,
  cwd: () => process.cwd(),
  listBranches,
  branchExists,
  pathExists,
  promptBranch: async (branches) => {
    assertInteractiveInput("escolher a branch");
    return select({
      message: "Em qual branch rodar o pull?",
      choices: branches.map((b) => ({ name: b, value: b })),
    });
  },
};

export async function pullAction(
  remote: string | undefined,
  branch: string | undefined,
  opts: { branch?: string },
  deps: Partial<PullActionDeps> = {},
): Promise<void> {
  const d = { ...defaultDeps, ...deps };
  const targetRemote = remote ?? "origin";
  const targetBranch = branch ?? DEFAULT_BRANCH_ALIAS;

  const worktree = await resolveWorktree(opts.branch, d);
  const repos = PULL_REPOS
    .map((repo) => ({ repo, path: join(WORKTREES_DIR, worktree, repo) }))
    .filter(({ path }) => d.pathExists(path));

  if (repos.length === 0) {
    throw new Error(`Nenhum repo encontrado na branch '${worktree}'`);
  }

  const s = spinner(`Atualizando ${repos.length} repos de ${worktree} (${targetRemote} ${targetBranch})...`).start();
  const results = await Promise.all(
    repos.map(({ repo, path }) => pullRepo(repo, path, targetRemote, targetBranch, d)),
  );
  s.stop();

  printSummary(worktree, results);

  if (results.every((r) => r.status === "skipped")) {
    throw new Error(`Branch '${targetBranch}' não existe em ${targetRemote} em nenhum repo`);
  }
  if (results.some((r) => r.status === "failed")) {
    process.exitCode = 1;
  }
}

async function resolveWorktree(explicit: string | undefined, d: PullActionDeps): Promise<string> {
  if (explicit) {
    if (!d.branchExists(explicit)) throw new Error(`Branch '${explicit}' não encontrada`);
    return explicit;
  }

  const inferred = inferWorktreeFromCwd(d.cwd());
  if (inferred && d.branchExists(inferred)) return inferred;

  const branches = d.listBranches();
  if (branches.length === 0) throw new Error("Nenhuma branch de workspace encontrada");
  return d.promptBranch(branches);
}

export function inferWorktreeFromCwd(cwd: string): string | null {
  const rel = relative(WORKTREES_DIR, cwd);
  if (!rel || rel.startsWith("..") || rel.startsWith(sep)) return null;
  return rel.split(sep)[0] || null;
}

async function pullRepo(
  repo: string,
  path: string,
  remote: string,
  branch: string,
  d: PullActionDeps,
): Promise<PullRepoResult> {
  const git = (...args: string[]) => d.exec(["git", "-C", path, ...args], { silent: true });

  try {
    let target = branch;
    if (branch === DEFAULT_BRANCH_ALIAS) {
      const resolved = await resolveDefaultBranch(remote, git);
      if (!resolved) {
        return { repo, path, status: "skipped", message: `branch principal não encontrada em ${remote}` };
      }
      target = resolved;
    } else {
      const heads = await git("ls-remote", "--heads", remote, branch);
      if (heads.exitCode !== 0) return failed(repo, path, branch, heads);
      if (!heads.stdout.trim()) {
        return { repo, path, branch, status: "skipped", message: `branch não existe em ${remote}` };
      }
    }

    const before = await git("rev-parse", "HEAD");
    const pull = await git("pull", remote, target);
    if (pull.exitCode !== 0) return failed(repo, path, target, pull);
    const after = await git("rev-parse", "HEAD");

    const changed = before.stdout.trim() !== after.stdout.trim();
    return { repo, path, branch: target, status: changed ? "updated" : "up-to-date" };
  } catch (error) {
    return { repo, path, branch, status: "failed", message: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Resolve @default para a branch principal do repo: origin/HEAD local,
 * ou a primeira de main/master que existir no remoto.
 */
async function resolveDefaultBranch(
  remote: string,
  git: (...args: string[]) => Promise<ShellResult>,
): Promise<string | null> {
  const head = await git("symbolic-ref", "--short", `refs/remotes/${remote}/HEAD`);
  const ref = head.stdout.trim();
  if (head.exitCode === 0 && ref.startsWith(`${remote}/`)) {
    return ref.slice(remote.length + 1);
  }

  for (const candidate of DEFAULT_BRANCH_FALLBACKS) {
    const heads = await git("ls-remote", "--heads", remote, candidate);
    if (heads.exitCode === 0 && heads.stdout.trim()) return candidate;
  }
  return null;
}

function failed(repo: string, path: string, branch: string, result: ShellResult): PullRepoResult {
  const output = (result.stderr || result.stdout).trim();
  return { repo, path, branch, status: "failed", message: output || `git saiu com código ${result.exitCode}` };
}

function printSummary(worktree: string, results: PullRepoResult[]): void {
  section(`Pull em ${worktree}`);
  for (const r of results) {
    const label = r.branch ? `${r.repo} ${colors.muted(`(${r.branch})`)}` : r.repo;
    switch (r.status) {
      case "updated":
        console.error(`  ${colors.ok("✓")} ${label} ${colors.ok("atualizado")}`);
        break;
      case "up-to-date":
        console.error(`  ${colors.muted("=")} ${label} ${colors.muted("já atualizado")}`);
        break;
      case "skipped":
        console.error(`  ${colors.warn("⚠")} ${label} ${colors.warn(`ignorado: ${r.message}`)}`);
        break;
      case "failed":
        console.error(`  ${colors.err("✗")} ${label} ${colors.err("falhou")} ${colors.muted(r.path)}`);
        for (const line of (r.message ?? "").split("\n")) {
          console.error(`      ${colors.muted(line)}`);
        }
        break;
    }
  }
  emptyLine();
}
