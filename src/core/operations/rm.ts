import { rm } from "fs/promises";
import { join } from "path";
import { removeBranchSnapshots } from "../../actions/snapshot";
import {
  BACKEND_REPO,
  DOCS_REPO,
  FRONTEND_REPO,
  MANAGER_REPO,
  PARENTS_REPO,
  PRODUCT_NAME,
  REPORT_SERVER_REPO,
  WORKTREES_DIR,
  readWorkspaceEnv,
  resolveBranchStateDir,
  type WorkspaceEnv,
} from "../../lib/config";
import { dockerComposeDown, dockerVolumeRm } from "../../lib/docker";
import { pathExists as defaultPathExists } from "../../lib/filesystem";
import { deleteBranch, removeWorktree } from "../../lib/git";
import { removeAlias } from "../../lib/portless";
import { stopBranchSessions } from "../../lib/services";
import { exec } from "../../lib/shell";
import type { NsContext } from "../context";
import { NsError, asNsError, naoEncontrado, preCondicao } from "../errors";

export interface RmInput {
  branch: string;
  purge?: boolean;   // também apaga o volume do banco e os snapshots da branch
  force?: boolean;   // remove mesmo com alterações não commitadas
}

export interface RmResult {
  branch: string;
  purged: boolean;
}

/** Um Repo da branch com alterações não commitadas, e os arquivos alterados. */
export interface UncommittedRepo {
  repo: string;
  files: string[];
}

/** O que `rm` vai apagar, e o que impede a remoção sem `force`. */
export interface RmPreview {
  branch: string;
  path: string;
  repos: string[];
  volume: string;
  uncommitted: UncommittedRepo[];
}

export interface RmDeps {
  readEnv: typeof readWorkspaceEnv;
  pathExists: typeof defaultPathExists;
  exec: typeof exec;
  stopSessions: (slug: string) => Promise<void>;
  composeDown: typeof dockerComposeDown;
  volumeRm: typeof dockerVolumeRm;
  rmAlias: typeof removeAlias;
  rmWorktree: typeof removeWorktree;
  delBranch: typeof deleteBranch;
  rmSnapshots: typeof removeBranchSnapshots;
  rmDir: (path: string) => Promise<void>;
}

const defaultDeps: RmDeps = {
  readEnv: readWorkspaceEnv,
  pathExists: defaultPathExists,
  exec,
  stopSessions: (slug) => stopBranchSessions(slug),
  composeDown: dockerComposeDown,
  volumeRm: dockerVolumeRm,
  rmAlias: removeAlias,
  rmWorktree: removeWorktree,
  delBranch: deleteBranch,
  rmSnapshots: removeBranchSnapshots,
  rmDir: (path) => rm(path, { recursive: true, force: true }),
};

const BRANCH_REPOS = [
  { repo: "backend", main: BACKEND_REPO, always: true },
  { repo: "frontend", main: FRONTEND_REPO, always: true },
  { repo: "docs", main: DOCS_REPO, always: false },
  { repo: "parents", main: PARENTS_REPO, always: false },
  { repo: "manager", main: MANAGER_REPO, always: false },
  { repo: "report-server", main: REPORT_SERVER_REPO, always: false },
];

/** Prévia de Remover branch: os Repos da branch e quais têm alterações não commitadas. */
export async function runRmPreview(
  input: { branch: string },
  _ctx: NsContext,
  deps: Partial<RmDeps> = {},
): Promise<RmPreview> {
  const d = { ...defaultDeps, ...deps };
  const { branch } = input;
  const env = await readEnv(branch, d);
  const repos = branchRepos(branch, d);
  return {
    branch,
    path: join(WORKTREES_DIR, branch),
    repos: repos.map(({ repo }) => repo),
    volume: env.DB_VOLUME,
    uncommitted: await uncommittedRepos(repos, d),
  };
}

/**
 * Remover branch: para os Serviços e o banco, tira os aliases, as worktrees, as branches locais,
 * os logs e a pasta. Com alterações não commitadas em algum Repo, só remove com `force`.
 * O volume do banco fica, a não ser com `purge`.
 */
export async function runRm(input: RmInput, ctx: NsContext, deps: Partial<RmDeps> = {}): Promise<RmResult> {
  const d = { ...defaultDeps, ...deps };
  const { branch, purge = false, force = false } = input;
  const env = await readEnv(branch, d);
  const repos = branchRepos(branch, d);
  if (!force) {
    const uncommitted = await uncommittedRepos(repos, d);
    if (uncommitted.length > 0) throw uncommittedError(branch, uncommitted);
  }

  const wtDir = join(WORKTREES_DIR, branch);
  const slug = env.BRANCH_SLUG || branch.toLowerCase();
  const step = async (id: string, label: string, fn: () => Promise<void>) => {
    ctx.emit({ step: id, label });
    await fn().catch((error) => { throw asNsError(error); });
  };

  await step("rm:stop", "Parando serviços...", async () => {
    await d.stopSessions(slug);
    await d.composeDown(join(wtDir, "docker-compose.yml"), env.COMPOSE_PROJECT);
  });
  await step("rm:aliases", "Removendo aliases Portless...", async () => {
    for (const alias of aliases(slug, env)) await d.rmAlias(alias);
  });
  if (purge) {
    await step("rm:volume", "Removendo volume Docker...", () => d.volumeRm(env.DB_VOLUME));
    await step("rm:snapshots", "Removendo snapshots...", () => d.rmSnapshots(branch));
  }
  await step("rm:worktrees", "Removendo worktrees...", async () => {
    for (const { main, path } of repos) await d.rmWorktree(main, path, { force });
  });
  await step("rm:branches", "Removendo branches locais...", async () => {
    for (const { main } of repos) await d.delBranch(main, branch);
  });
  await step("rm:logs", "Removendo logs...", () => d.rmDir(resolveBranchStateDir(branch)));
  await step("rm:dir", "Removendo diretório...", () => d.rmDir(wtDir));
  return { branch, purged: purge };
}

/** A recusa de `rm` sem `force`, com os Repos que têm alterações não commitadas. */
export function uncommittedError(
  branch: string,
  uncommitted: UncommittedRepo[],
  hint = "Faça commit ou descarte e tente de novo.",
): NsError {
  const repos = uncommitted.map(({ repo, files }) => `${repo} (${files.length} ${files.length === 1 ? "arquivo" : "arquivos"})`);
  return preCondicao(
    `A branch '${branch}' tem alterações não commitadas em ${repos.join(", ")}`,
    hint,
  );
}

async function readEnv(branch: string, d: RmDeps): Promise<WorkspaceEnv> {
  const env = await d.readEnv(branch);
  if (!env) throw naoEncontrado(`Branch '${branch}' não encontrada`, "Rode 'ns status' para ver as branches disponíveis.");
  return env;
}

function branchRepos(branch: string, d: RmDeps) {
  return BRANCH_REPOS
    .map((spec) => ({ ...spec, path: join(WORKTREES_DIR, branch, spec.repo) }))
    .filter(({ always, path }) => always || d.pathExists(path));
}

async function uncommittedRepos(repos: { repo: string; path: string }[], d: RmDeps): Promise<UncommittedRepo[]> {
  const found = await Promise.all(repos.filter(({ path }) => d.pathExists(path)).map(async ({ repo, path }) => {
    const status = await d.exec(["git", "-C", path, "status", "--porcelain", "-z"], { silent: true });
    if (status.exitCode !== 0) throw asNsError(new Error(`git status falhou em ${repo}: ${(status.stderr || status.stdout).trim()}`));
    return { repo, files: changedFiles(status.stdout) };
  }));
  return found.filter(({ files }) => files.length > 0);
}

/** Lê `git status --porcelain -z`: "XY caminho", e numa renomeação o caminho de origem vem logo depois. */
function changedFiles(porcelain: string): string[] {
  const entries = porcelain.split("\0").filter(Boolean);
  const files: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    files.push(entry.slice(3));
    if (entry[0] === "R" || entry[0] === "C") i++;
  }
  return files;
}

function aliases(slug: string, env: WorkspaceEnv): string[] {
  return [
    `${slug}.web.${PRODUCT_NAME}`,
    `${slug}.api.${PRODUCT_NAME}`,
    ...(env.MANAGER_PORT ? [`${slug}.manager.${PRODUCT_NAME}`] : []),
    ...(env.REPORT_SERVER_PORT ? [`${slug}.report-server.${PRODUCT_NAME}`] : []),
  ];
}
