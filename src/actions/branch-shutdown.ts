import { join } from "path";
import {
  readWorkspaceEnv,
  resolveServiceSession,
  WORKTREES_DIR,
  PRODUCT_NAME,
  type WorkspaceEnv,
} from "../lib/config";
import type { ServiceId } from "../core";
import { stopBranchSessions, stopService } from "../lib/services";
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
  constructor(readonly branch: string, message = `Branch '${branch}' não encontrada`) {
    super(message);
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
  await stopBranchProcesses(env, aliasSlug, run);

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

/**
 * Para um Serviço só: a sessão dele e o que atende na porta dele. O banco, os aliases e
 * os outros Serviços ficam como estão.
 */
export async function shutdownService(
  branch: string,
  service: ServiceId,
  deps: Partial<Pick<BranchShutdownDeps, "readEnv" | "exec">> = {},
): Promise<void> {
  const { readEnv, exec: run } = { ...defaultBranchShutdownDeps, ...deps };

  const env = await readEnv(branch);
  if (!env) {
    throw new BranchShutdownNotFoundError(branch);
  }
  const port = servicePort(env, service);
  if (!port) {
    throw new BranchShutdownNotFoundError(branch, `A branch '${branch}' não tem o Serviço ${service}`);
  }

  await stopService(resolveServiceSession(env.BRANCH_SLUG || branch.toLowerCase(), service), run);
  await killPort(port, run);
}

function servicePort(env: WorkspaceEnv, service: ServiceId): number | undefined {
  switch (service) {
    case "backend": return env.BACKEND_PORT;
    case "frontend": return env.FRONTEND_PORT;
    case "manager": return env.MANAGER_PORT;
    case "report-server": return env.REPORT_SERVER_PORT;
  }
}

async function stopBranchProcesses(env: WorkspaceEnv, aliasSlug: string, run: typeof exec): Promise<void> {
  // As sessões caem primeiro, senão matar o processo deixa a sessão com o painel morto.
  // O kill por porta fica para Serviço que subiu por fora do tmux.
  await stopBranchSessions(aliasSlug, run);

  const ports = [env.BACKEND_PORT, env.FRONTEND_PORT, env.MANAGER_PORT, env.REPORT_SERVER_PORT].filter(
    (port): port is number => Boolean(port),
  );

  for (const port of ports) {
    await killPort(port, run);
  }
}

async function killPort(port: number, run: typeof exec): Promise<void> {
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
