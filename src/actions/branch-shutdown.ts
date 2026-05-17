import { join } from "path";
import {
  readWorkspaceEnv,
  WORKTREES_DIR,
  PRODUCT_NAME,
  type WorkspaceEnv,
} from "../lib/config";
import { dockerComposeDown } from "../lib/docker";
import { removeAlias } from "../lib/portless";
import { assertSuccess, commandErrorMessage, exec } from "../lib/shell";

export type BranchShutdownStep = "database:stop" | "portless:aliases" | "processes:stop";

export interface BranchShutdownDeps {
  readEnv: typeof readWorkspaceEnv;
  composeDown: typeof dockerComposeDown;
  rmAlias: typeof removeAlias;
  exec: typeof exec;
}

export interface BranchShutdownOptions {
  onStep?: (step: BranchShutdownStep) => void;
}

export interface BranchShutdownRuntime {
  env: WorkspaceEnv;
  wtDir: string;
  composeFile: string;
  aliasSlug: string;
  aliases: {
    backend: string;
    frontend: string;
    manager?: string;
  };
}

export class BranchShutdownNotFoundError extends Error {
  constructor(readonly branch: string) {
    super(`Branch '${branch}' não encontrada`);
    this.name = "BranchShutdownNotFoundError";
  }
}

export const defaultBranchShutdownDeps: BranchShutdownDeps = {
  readEnv: readWorkspaceEnv,
  composeDown: dockerComposeDown,
  rmAlias: removeAlias,
  exec,
};

export async function shutdownBranchRuntime(
  branch: string,
  options: BranchShutdownOptions = {},
  deps: Partial<BranchShutdownDeps> = {},
): Promise<BranchShutdownRuntime> {
  const { readEnv, composeDown, rmAlias, exec: run } = { ...defaultBranchShutdownDeps, ...deps };

  const env = await readEnv(branch);
  if (!env) {
    throw new BranchShutdownNotFoundError(branch);
  }

  const wtDir = join(WORKTREES_DIR, branch);
  const composeFile = join(wtDir, "docker-compose.yml");
  const aliasSlug = env.BRANCH_SLUG || branch.toLowerCase();
  const aliases = buildPortlessAliases(aliasSlug, env);

  options.onStep?.("database:stop");
  await composeDown(composeFile, env.COMPOSE_PROJECT);

  options.onStep?.("portless:aliases");
  await rmAlias(aliases.frontend);
  await rmAlias(aliases.backend);
  if (aliases.manager) {
    await rmAlias(aliases.manager);
  }

  options.onStep?.("processes:stop");
  await stopBranchProcesses(env, run);

  return {
    env,
    wtDir,
    composeFile,
    aliasSlug,
    aliases,
  };
}

function buildPortlessAliases(aliasSlug: string, env: WorkspaceEnv): BranchShutdownRuntime["aliases"] {
  return {
    backend: `${aliasSlug}.api.${PRODUCT_NAME}`,
    frontend: `${aliasSlug}.web.${PRODUCT_NAME}`,
    manager: env.MANAGER_PORT ? `${aliasSlug}.manager.${PRODUCT_NAME}` : undefined,
  };
}

async function stopBranchProcesses(env: WorkspaceEnv, run: typeof exec): Promise<void> {
  const ports = [env.BACKEND_PORT, env.FRONTEND_PORT, env.MANAGER_PORT].filter(
    (port): port is number => Boolean(port),
  );

  for (const port of ports) {
    const result = await run(["lsof", "-ti", `:${port}`], { silent: true });
    if (result.exitCode !== 0 && result.stderr.trim()) {
      throw new Error(commandErrorMessage(`listar processos na porta ${port}`, result));
    }

    const pids = result.stdout.trim().split("\n").filter(Boolean);
    for (const pid of pids) {
      const killResult = await run(["kill", "-9", pid], { silent: true });
      assertSuccess(killResult, `encerrar processo ${pid}`);
    }
  }
}
