import { join } from "path";
import {
  BACKEND_REPO,
  DOCS_REPO,
  FRONTEND_REPO,
  MANAGER_REPO,
  PARENTS_REPO,
  PRODUCT_NAME,
  REPORT_SERVER_REPO,
  WORKTREES_DIR,
  listBranches as defaultListBranches,
  readWorkspaceEnv as defaultReadWorkspaceEnv,
  resolveServiceSession,
  type WorkspaceEnv,
} from "../../lib/config";
import { pathExists } from "../../lib/filesystem";
import { listRunningContainers as defaultListRunningContainers } from "../../lib/docker";
import { listListeningPorts as defaultListListeningPorts } from "../../lib/ports";
import { type ServicePane, listServicePanes as defaultListServicePanes } from "../../lib/services";
import {
  getBranchFlagsMany as defaultGetBranchFlagsMany,
  type BranchFlagInfo,
} from "../../lib/branch-flags";
import type { NsContext } from "../context";
import { naoEncontrado } from "../errors";

export interface StatusInput {
  branch?: string;   // ausente = todas as branches
}

/**
 * Estado de Serviço, como no glossário: Parado, Iniciando, Rodando ou Falhou.
 * O banco só tem Parado e Rodando.
 */
export type ServiceState = "parado" | "iniciando" | "rodando" | "falhou";
export type DbState = Extract<ServiceState, "parado" | "rodando">;

export interface BranchStatus {
  branch: string;
  slug: string;
  path: string;                       // WORKTREES_DIR/<branch>
  dbContainer: string;
  ports: {
    db: number; backend: number; frontend: number;
    manager?: number; reportServer?: number;
  };
  services: {
    db: DbState;
    backend: ServiceState;
    frontend: ServiceState;
    manager: ServiceState | null;     // null = não existe nesta branch
    reportServer: ServiceState | null;
  };
  aliases: {                          // alias Portless esperado de cada serviço
    backend: string; frontend: string;
    manager?: string; reportServer?: string;
  };
  flags: string[];
  stale: boolean;
  lastCommitAt: string | null;
  lastCliUsedAt: string | null;
}

/** Checkout principal de um Repo, de onde as branches de workspace saem. */
export interface BaseRepo {
  repo: string;
  path: string;
}

export interface StatusResult {
  baseRepos: BaseRepo[];
  branches: BranchStatus[];
}

export interface StatusDeps {
  listBranches: typeof defaultListBranches;
  readWorkspaceEnv: typeof defaultReadWorkspaceEnv;
  listRunningContainers: typeof defaultListRunningContainers;
  listListeningPorts: () => Promise<Set<number>>;
  listServicePanes: () => Promise<Map<string, ServicePane>>;
  getBranchFlagsMany: typeof defaultGetBranchFlagsMany;
  listBaseRepos: () => BaseRepo[];
}

/**
 * Leitura única do estado de uma ou de todas as branches.
 * Entradas do workspace sem `.workspace.env` são ignoradas quando se lê tudo;
 * quando a branch foi pedida por nome, a ausência é erro.
 *
 * Docker, portas, tmux e git são consultados em lote: o custo não cresce por branch.
 */
export async function runStatus(
  input: StatusInput,
  ctx: NsContext,
  deps: Partial<StatusDeps> = {},
): Promise<StatusResult> {
  const listBranches = deps.listBranches ?? defaultListBranches;
  const readWorkspaceEnv = deps.readWorkspaceEnv ?? defaultReadWorkspaceEnv;
  const listRunningContainers = deps.listRunningContainers ?? defaultListRunningContainers;
  const listListeningPorts = deps.listListeningPorts ?? defaultListListeningPorts;
  const listServicePanes = deps.listServicePanes ?? defaultListServicePanes;
  const getBranchFlagsMany = deps.getBranchFlagsMany ?? defaultGetBranchFlagsMany;
  const listBaseRepos = deps.listBaseRepos ?? defaultListBaseRepos;

  const names = input.branch ? [input.branch] : listBranches();
  const [listening, panes, runningContainers] = await Promise.all([
    listListeningPorts(),
    listServicePanes(),
    listRunningContainers(),
  ]);

  const found: Array<{ branch: string; env: WorkspaceEnv }> = [];

  for (const [index, branch] of names.entries()) {
    ctx.emit({
      step: "status:branch",
      label: `Lendo status de ${branch}...`,
      index: index + 1,
      total: names.length,
    });

    const env = await readWorkspaceEnv(branch);
    if (!env) {
      if (input.branch) {
        throw naoEncontrado(
          `Worktree não encontrada para '${branch}'`,
          "Rode 'ns status' para ver as branches disponíveis.",
        );
      }
      continue;
    }

    found.push({ branch, env });
  }

  const flagsByBranch = await getBranchFlagsMany(found.map(({ branch }) => branch));

  const branches = found.map(({ branch, env }): BranchStatus => {
    const slug = env.BRANCH_SLUG || branch.toLowerCase();
    const backendAlias = `${slug}.api.${PRODUCT_NAME}`;
    const frontendAlias = `${slug}.web.${PRODUCT_NAME}`;
    const managerAlias = `${slug}.manager.${PRODUCT_NAME}`;
    const reportServerAlias = `${slug}.report-server.${PRODUCT_NAME}`;
    const flags = flagsByBranch.get(branch) ?? EMPTY_FLAGS;
    const stateOf = (id: string, port: number) =>
      deriveServiceState(listening.has(port), panes.get(resolveServiceSession(slug, id)));

    return {
      branch,
      slug,
      path: join(WORKTREES_DIR, branch),
      dbContainer: env.DB_CONTAINER,
      ports: {
        db: env.DB_PORT,
        backend: env.BACKEND_PORT,
        frontend: env.FRONTEND_PORT,
        manager: env.MANAGER_PORT,
        reportServer: env.REPORT_SERVER_PORT,
      },
      services: {
        db: runningContainers.includes(env.DB_CONTAINER) ? "rodando" : "parado",
        backend: stateOf("backend", env.BACKEND_PORT),
        frontend: stateOf("frontend", env.FRONTEND_PORT),
        manager: env.MANAGER_PORT ? stateOf("manager", env.MANAGER_PORT) : null,
        reportServer: env.REPORT_SERVER_PORT ? stateOf("report-server", env.REPORT_SERVER_PORT) : null,
      },
      aliases: {
        backend: backendAlias,
        frontend: frontendAlias,
        manager: env.MANAGER_PORT ? managerAlias : undefined,
        reportServer: env.REPORT_SERVER_PORT ? reportServerAlias : undefined,
      },
      flags: flags.flags,
      stale: flags.stale,
      lastCommitAt: flags.lastCommitAt,
      lastCliUsedAt: flags.lastCliUsedAt,
    };
  });

  return { baseRepos: listBaseRepos(), branches };
}

/**
 * Rodando é atender na porta, venha o processo de onde vier (sessão tmux, terminal, IDE).
 * Fora da porta, a sessão tmux diz o resto: painel vivo é Iniciando; painel que terminou com
 * erro, mantido pelo `remain-on-exit`, é Falhou. Encerrado por alguém, ou sem sessão, é Parado.
 */
export function deriveServiceState(listening: boolean, pane: ServicePane | undefined): ServiceState {
  if (listening) return "rodando";
  if (pane === "alive") return "iniciando";
  if (pane === "failed") return "falhou";
  return "parado";
}

/** Repos base presentes no disco, na ordem em que uma branch de workspace os tem. */
function defaultListBaseRepos(): BaseRepo[] {
  return [
    { repo: "backend", path: BACKEND_REPO },
    { repo: "frontend", path: FRONTEND_REPO },
    { repo: "manager", path: MANAGER_REPO },
    { repo: "report-server", path: REPORT_SERVER_REPO },
    { repo: "docs", path: DOCS_REPO },
    { repo: "parents", path: PARENTS_REPO },
  ].filter(({ path }) => pathExists(path));
}

const EMPTY_FLAGS: BranchFlagInfo = {
  flags: [],
  stale: false,
  lastCommitAt: null,
  lastCliUsedAt: null,
};
