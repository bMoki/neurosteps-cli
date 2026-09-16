import { join } from "path";
import {
  PRODUCT_NAME,
  WORKTREES_DIR,
  listBranches as defaultListBranches,
  readWorkspaceEnv as defaultReadWorkspaceEnv,
  type WorkspaceEnv,
} from "../../lib/config";
import { listRunningContainers as defaultListRunningContainers } from "../../lib/docker";
import { listAliases as defaultListAliases } from "../../lib/portless";
import {
  getBranchFlagsMany as defaultGetBranchFlagsMany,
  type BranchFlagInfo,
} from "../../lib/branch-flags";
import type { NsContext } from "../context";
import { naoEncontrado } from "../errors";

export interface StatusInput {
  branch?: string;   // ausente = todas as branches
}

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
    db: boolean;
    backend: boolean;
    frontend: boolean;
    manager: boolean | null;          // null = não existe nesta branch
    reportServer: boolean | null;
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

export interface StatusResult {
  branches: BranchStatus[];
}

export interface StatusDeps {
  listBranches: typeof defaultListBranches;
  readWorkspaceEnv: typeof defaultReadWorkspaceEnv;
  listRunningContainers: typeof defaultListRunningContainers;
  listAliases: typeof defaultListAliases;
  getBranchFlagsMany: typeof defaultGetBranchFlagsMany;
}

/**
 * Leitura única do estado de uma ou de todas as branches.
 * Entradas do workspace sem `.workspace.env` são ignoradas quando se lê tudo;
 * quando a branch foi pedida por nome, a ausência é erro.
 *
 * Docker, Portless e git são consultados em lote: o custo não cresce por branch.
 */
export async function runStatus(
  input: StatusInput,
  ctx: NsContext,
  deps: Partial<StatusDeps> = {},
): Promise<StatusResult> {
  const listBranches = deps.listBranches ?? defaultListBranches;
  const readWorkspaceEnv = deps.readWorkspaceEnv ?? defaultReadWorkspaceEnv;
  const listRunningContainers = deps.listRunningContainers ?? defaultListRunningContainers;
  const listAliases = deps.listAliases ?? defaultListAliases;
  const getBranchFlagsMany = deps.getBranchFlagsMany ?? defaultGetBranchFlagsMany;

  const names = input.branch ? [input.branch] : listBranches();
  const [aliases, runningContainers] = await Promise.all([
    listAliases(),
    listRunningContainers(),
  ]);
  const isAliasActive = (alias: string) =>
    aliases.some((a) => a.toLowerCase().includes(alias.toLowerCase()));

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

  const branches = found.map(({ branch, env }) => {
    const slug = env.BRANCH_SLUG || branch.toLowerCase();
    const backendAlias = `${slug}.api.${PRODUCT_NAME}`;
    const frontendAlias = `${slug}.web.${PRODUCT_NAME}`;
    const managerAlias = `${slug}.manager.${PRODUCT_NAME}`;
    const reportServerAlias = `${slug}.report-server.${PRODUCT_NAME}`;
    const flags = flagsByBranch.get(branch) ?? EMPTY_FLAGS;

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
        db: runningContainers.includes(env.DB_CONTAINER),
        backend: isAliasActive(backendAlias),
        frontend: isAliasActive(frontendAlias),
        manager: env.MANAGER_PORT ? isAliasActive(managerAlias) : null,
        reportServer: env.REPORT_SERVER_PORT ? isAliasActive(reportServerAlias) : null,
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

  return { branches };
}

const EMPTY_FLAGS: BranchFlagInfo = {
  flags: [],
  stale: false,
  lastCommitAt: null,
  lastCliUsedAt: null,
};
