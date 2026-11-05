import { join } from "path";
import {
  BACKEND_CORE_MODULE,
  DOCS_REPO,
  MANAGER_REPO,
  PARENTS_REPO,
  PORTLESS_PROXY_PORT,
  PRODUCT_NAME,
  REPORT_SERVER_REPO,
  WORKSPACE_DIR,
  WORKTREES_DIR,
  readWorkspaceEnv,
} from "../../lib/config";
import {
  branchExistsOnOrigin,
  createLocalBranch,
  createTrackingBranch,
  createWorktree,
  fetchOrigin,
  localBranchExists,
  removeWorktree,
} from "../../lib/git";
import { getNextPort } from "../../lib/ports";
import { copyTemplate } from "../../lib/templates";
import { exec, execChecked } from "../../lib/shell";
import { ensureWorkspaceBootstrap } from "../../lib/bootstrap";
import { MASTER_MANAGER_PORT, MASTER_REPORT_SERVER_PORT } from "../../lib/env";
import { pathExists } from "../../lib/filesystem";
import type { NsContext } from "../context";
import { asNsError, conflito, naoEncontrado, preCondicao } from "../errors";

/** Repos que uma Branch de workspace pode ou não ter, escolhidos ao criá-la. */
export const OPTIONAL_REPOS = ["manager", "report-server", "parents"] as const;
export type OptionalRepo = (typeof OPTIONAL_REPOS)[number];

/** Repos que `add` inclui numa Branch de workspace que já existe. */
export const ADDABLE_REPOS = [...OPTIONAL_REPOS, "docs"] as const;
export type AddableRepo = (typeof ADDABLE_REPOS)[number];

export interface AddRepoInput {
  branch: string;
  repo: AddableRepo;
  base?: string;   // default: a base padrão do Repo, usada quando a branch não existe nele
  port?: number;   // só manager e report-server; default: a do .workspace.env ou a próxima livre
}

export interface AddRepoResult {
  branch: string;
  repo: AddableRepo;
  path: string;
  port?: number;
}

export interface AddRepoDeps {
  readEnv: typeof readWorkspaceEnv;
  fetch: typeof fetchOrigin;
  branchExistsOrigin: typeof branchExistsOnOrigin;
  localExists: typeof localBranchExists;
  trackBranch: typeof createTrackingBranch;
  localBranch: typeof createLocalBranch;
  worktree: typeof createWorktree;
  removeWorktree: typeof removeWorktree;
  allocatePort: (base: number) => number;
  shell: typeof exec;
  exists: (path: string) => boolean;
  ensureBootstrap: typeof ensureWorkspaceBootstrap;
  copyTpl: typeof copyTemplate;
  readText: (path: string) => Promise<string>;
  writeText: (path: string, content: string) => Promise<unknown>;
}

const defaultDeps: AddRepoDeps = {
  readEnv: readWorkspaceEnv,
  fetch: fetchOrigin,
  branchExistsOrigin: branchExistsOnOrigin,
  localExists: localBranchExists,
  trackBranch: createTrackingBranch,
  localBranch: createLocalBranch,
  worktree: createWorktree,
  removeWorktree,
  allocatePort: (base) => getNextPort(base),
  shell: execChecked,
  exists: pathExists,
  ensureBootstrap: ensureWorkspaceBootstrap,
  copyTpl: copyTemplate,
  readText: (path) => Bun.file(path).text(),
  writeText: (path, content) => Bun.write(path, content),
};

interface Configure {
  branch: string;
  slug: string;
  wtDir: string;
  dir: string;
  port: number;
}

interface RepoSpec {
  label: string;
  origin: string;
  defaultBase: string;
  port?: { key: "MANAGER_PORT" | "REPORT_SERVER_PORT"; base: number };
  configure?: (args: Configure, deps: AddRepoDeps) => Promise<void>;
}

/** Montado a cada chamada: caminhos e portas vêm do env, carregado depois do import. */
function repoSpec(repo: AddableRepo): RepoSpec {
  const specs: Record<AddableRepo, RepoSpec> = {
    manager: {
      label: "Manager",
      origin: MANAGER_REPO,
      defaultBase: "master",
      port: { key: "MANAGER_PORT", base: MASTER_MANAGER_PORT },
      configure: ({ branch, slug, dir, port }, { copyTpl }) =>
        copyTpl(join(WORKSPACE_DIR, "templates/manager-.env.local"), join(dir, ".env.local"), {
          BRANCH_NAME: branch,
          BRANCH_SLUG: slug,
          MANAGER_PORT: String(port),
          PRODUCT_NAME,
          PORTLESS_PROXY_PORT: String(PORTLESS_PROXY_PORT),
        }),
    },
    "report-server": {
      label: "Report-server",
      origin: REPORT_SERVER_REPO,
      defaultBase: "master",
      port: { key: "REPORT_SERVER_PORT", base: MASTER_REPORT_SERVER_PORT },
      configure: async ({ branch, slug, wtDir, dir, port }, { copyTpl, exists, readText, writeText }) => {
        const backendProps = join(wtDir, `backend/${BACKEND_CORE_MODULE}/src/main/resources/application-dev.properties`);
        if (exists(backendProps)) {
          const url = `https://${slug}.report-server.${PRODUCT_NAME}.localhost:${PORTLESS_PROXY_PORT}`;
          await writeText(backendProps, pointBackendAtReportServer(await readText(backendProps), url));
        }
        await copyTpl(join(WORKSPACE_DIR, "templates/report-server-.env"), join(dir, ".env"), {
          BRANCH_NAME: branch,
          BRANCH_SLUG: slug,
          REPORT_SERVER_PORT: String(port),
          PRODUCT_NAME,
          PORTLESS_PROXY_PORT: String(PORTLESS_PROXY_PORT),
        });
      },
    },
    parents: { label: "Parents", origin: PARENTS_REPO, defaultBase: "main" },
    docs: { label: "Docs", origin: DOCS_REPO, defaultBase: "master" },
  };
  return specs[repo];
}

export function repoLabel(repo: AddableRepo): string {
  return repoSpec(repo).label;
}

/** Incluir um Repo numa Branch de workspace que já existe: branch, worktree e configuração. */
export async function runAddRepo(
  input: AddRepoInput,
  ctx: NsContext,
  overrides: Partial<AddRepoDeps> = {},
): Promise<AddRepoResult> {
  const deps = { ...defaultDeps, ...overrides };
  const { branch, repo } = input;
  const spec = repoSpec(repo);
  const wtDir = join(WORKTREES_DIR, branch);
  const dir = join(wtDir, repo);
  const baseOriginBranch = (input.base || spec.defaultBase).replace(/^origin\//, "");
  const baseRef = `origin/${baseOriginBranch}`;

  const env = await deps.readEnv(branch);
  if (!env || !deps.exists(join(wtDir, ".workspace.env"))) {
    throw naoEncontrado(`Worktree '${branch}' não encontrada`, "Veja as branches com: ns status");
  }
  if (deps.exists(dir)) {
    throw conflito(`${spec.label} já existe em ${dir}`);
  }
  if (!deps.exists(join(spec.origin, ".git"))) {
    throw preCondicao(`Repositório ${spec.label} não encontrado em ${spec.origin}`, "Confira NS_BASE_DIR com: ns doctor");
  }
  if (input.port !== undefined && (!Number.isInteger(input.port) || input.port <= 0)) {
    throw preCondicao(`Porta inválida: ${input.port}`);
  }
  const port = spec.port && (input.port ?? env[spec.port.key] ?? deps.allocatePort(spec.port.base));

  let worktreeCreated = false;
  try {
    await deps.ensureBootstrap();

    ctx.emit({ step: `add:${repo}:branch`, label: `Configurando branch do ${repo}...` });
    await deps.fetch(spec.origin);
    if (await deps.branchExistsOrigin(spec.origin, branch)) {
      if (!deps.localExists(spec.origin, branch)) await deps.trackBranch(spec.origin, branch);
    } else if (!deps.localExists(spec.origin, branch)) {
      if (!(await deps.branchExistsOrigin(spec.origin, baseOriginBranch))) {
        throw naoEncontrado(`Branch base '${baseRef}' não existe no ${repo}`);
      }
      await deps.localBranch(spec.origin, branch, baseRef);
    }

    ctx.emit({ step: `add:${repo}:worktree`, label: `Criando worktree do ${repo}...` });
    await deps.shell(["mkdir", "-p", wtDir], { silent: true });
    await deps.worktree(spec.origin, dir, branch);
    worktreeCreated = true;

    ctx.emit({ step: `add:${repo}:config`, label: "Atualizando configuração da workspace..." });
    if (spec.port && port !== undefined) {
      const workspaceEnv = join(wtDir, ".workspace.env");
      await deps.writeText(workspaceEnv, upsertLine(await deps.readText(workspaceEnv), spec.port.key, `"${port}"`));
      await spec.configure?.({ branch, slug: env.BRANCH_SLUG, wtDir, dir, port }, deps);
    }
    await addFolderToCodeWorkspace(join(wtDir, `${branch}.code-workspace`), repo, deps);
  } catch (error) {
    // Desfaz a worktree criada aqui, para que repetir a inclusão não esbarre em "já existe".
    if (worktreeCreated) await deps.removeWorktree(spec.origin, dir, { force: true }).catch(() => {});
    throw asNsError(error);
  }

  return { branch, repo, path: dir, ...(port === undefined ? {} : { port }) };
}


function upsertLine(content: string, key: string, value: string): string {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=.*`, "m");
  if (pattern.test(content)) return content.replace(pattern, line);
  return content.endsWith("\n") ? `${content}${line}\n` : `${content}\n${line}\n`;
}

function pointBackendAtReportServer(content: string, url: string): string {
  const trusting = upsertLine(content, "%dev.quarkus.tls.trust-all", "true");
  return upsertLine(trusting, "%dev.quarkus.rest-client.report-service.url", url);
}

async function addFolderToCodeWorkspace(
  workspaceFile: string,
  folder: string,
  { exists, readText, writeText }: Pick<AddRepoDeps, "exists" | "readText" | "writeText">,
): Promise<void> {
  if (!exists(workspaceFile)) return;
  const parsed = JSON.parse(await readText(workspaceFile)) as {
    folders?: Array<{ name?: string; path?: string }>;
    [key: string]: unknown;
  };
  const folders = Array.isArray(parsed.folders) ? parsed.folders : [];
  if (!folders.some((entry) => entry.path === folder || entry.name === folder)) {
    folders.push({ name: folder, path: folder });
  }
  parsed.folders = folders;
  await writeText(workspaceFile, `${JSON.stringify(parsed, null, 2)}\n`);
}
