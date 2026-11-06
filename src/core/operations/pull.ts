import { join } from "path";
import { WORKTREES_DIR, branchExists as defaultBranchExists } from "../../lib/config";
import { pathExists as defaultPathExists } from "../../lib/filesystem";
import { exec, type ShellResult } from "../../lib/shell";
import type { NsContext } from "../context";
import { naoEncontrado, preCondicao } from "../errors";

export const DEFAULT_BRANCH_ALIAS = "@default";
const DEFAULT_BRANCH_FALLBACKS = ["main", "master"];
const PULL_REPOS = ["backend", "frontend", "manager", "report-server", "docs", "parents"];

/** `conflict`: o pull parou com arquivos em conflito, que ficam em aberto no Repo. */
export type PullStatus = "updated" | "up-to-date" | "skipped" | "failed" | "conflict";

export interface PullInput {
  branch: string;
  remote?: string;   // default: origin
  target?: string;   // default: @default, a Branch principal de cada Repo
}

export interface PullRepoResult {
  repo: string;
  path: string;
  branch?: string;
  status: PullStatus;
  message?: string;
  commits?: number;       // só em `updated`: quantos commits entraram
  conflicts?: string[];   // só em `conflict`: os arquivos em conflito
}

export interface PullResult {
  branch: string;
  repos: PullRepoResult[];
}

export interface PullDeps {
  exec: typeof exec;
  branchExists: typeof defaultBranchExists;
  pathExists: typeof defaultPathExists;
}

const defaultDeps: PullDeps = {
  exec,
  branchExists: defaultBranchExists,
  pathExists: defaultPathExists,
};

/**
 * Atualizar com a branch principal: roda `git pull` em cada Repo da Branch de workspace.
 * Falha de um Repo não para os outros; conflito fica em aberto para o desenvolvedor resolver.
 */
export async function runPull(input: PullInput, ctx: NsContext, deps: Partial<PullDeps> = {}): Promise<PullResult> {
  const d = { ...defaultDeps, ...deps };
  const { branch } = input;
  const remote = input.remote ?? "origin";
  const target = input.target ?? DEFAULT_BRANCH_ALIAS;

  if (!d.branchExists(branch)) {
    throw naoEncontrado(`Branch '${branch}' não encontrada`, "Rode 'ns status' para ver as branches disponíveis.");
  }
  const repos = PULL_REPOS
    .map((repo) => ({ repo, path: join(WORKTREES_DIR, branch, repo) }))
    .filter(({ path }) => d.pathExists(path));
  if (repos.length === 0) {
    throw preCondicao(`Nenhum repo encontrado na branch '${branch}'`);
  }

  const source = target === DEFAULT_BRANCH_ALIAS ? "a branch principal" : `${remote} ${target}`;
  ctx.emit({ step: "pull:repos", label: `Atualizando ${repos.length} repos com ${source}...` });
  const results = await Promise.all(repos.map(({ repo, path }) => pullRepo(repo, path, remote, target, d)));
  return { branch, repos: results };
}

async function pullRepo(
  repo: string,
  path: string,
  remote: string,
  branch: string,
  d: PullDeps,
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

    const before = (await git("rev-parse", "HEAD")).stdout.trim();
    const pull = await git("pull", remote, target);
    if (pull.exitCode !== 0) {
      const conflicts = await unmergedFiles(git);
      if (conflicts.length > 0) return { ...failed(repo, path, target, pull), status: "conflict", conflicts };
      return failed(repo, path, target, pull);
    }
    const after = (await git("rev-parse", "HEAD")).stdout.trim();

    if (before === after) return { repo, path, branch: target, status: "up-to-date" };
    const commits = Number.parseInt((await git("rev-list", "--count", `${before}..${after}`)).stdout.trim(), 10);
    return { repo, path, branch: target, status: "updated", ...(Number.isNaN(commits) ? {} : { commits }) };
  } catch (error) {
    return { repo, path, branch, status: "failed", message: error instanceof Error ? error.message : String(error) };
  }
}

async function unmergedFiles(git: (...args: string[]) => Promise<ShellResult>): Promise<string[]> {
  const diff = await git("diff", "--name-only", "--diff-filter=U");
  if (diff.exitCode !== 0) return [];
  return diff.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
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
