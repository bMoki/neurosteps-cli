import { join } from "path";
import {
  readWorkspaceEnv,
  WORKTREES_DIR,
  PRODUCT_NAME,
  PORTLESS_PROXY_PORT,
  type WorkspaceEnv,
} from "../lib/config";
import { dockerComposeUp, waitForPostgres } from "../lib/docker";
import { registerAlias, isProxyRunning, startProxy } from "../lib/portless";

export type BranchSetupStep =
  | "database:start"
  | "database:wait"
  | "portless:proxy"
  | "portless:aliases";

export interface BranchSetupDeps {
  readEnv: typeof readWorkspaceEnv;
  composeUp: typeof dockerComposeUp;
  waitPg: typeof waitForPostgres;
  regAlias: typeof registerAlias;
  proxyRunning: typeof isProxyRunning;
  proxyStart: typeof startProxy;
}

export interface BranchSetupOptions {
  startDatabase?: boolean;
  ensurePortlessProxy?: boolean;
  registerPortlessAliases?: boolean;
  onStep?: (step: BranchSetupStep) => void;
}

export interface BranchRuntime {
  env: WorkspaceEnv;
  wtDir: string;
  composeFile: string;
  aliasSlug: string;
  aliases: {
    backend: string;
    frontend: string;
    manager?: string;
  };
  urls: {
    backend: string;
    frontend: string;
    manager?: string;
  };
}

export class BranchNotFoundError extends Error {
  constructor(readonly branch: string) {
    super(`Branch '${branch}' não encontrada`);
    this.name = "BranchNotFoundError";
  }
}

export const defaultBranchSetupDeps: BranchSetupDeps = {
  readEnv: readWorkspaceEnv,
  composeUp: dockerComposeUp,
  waitPg: waitForPostgres,
  regAlias: registerAlias,
  proxyRunning: isProxyRunning,
  proxyStart: startProxy,
};

export async function setupBranchRuntime(
  branch: string,
  options: BranchSetupOptions = {},
  deps: Partial<BranchSetupDeps> = {},
): Promise<BranchRuntime> {
  const {
    readEnv,
    composeUp,
    waitPg,
    regAlias,
    proxyRunning,
    proxyStart,
  } = { ...defaultBranchSetupDeps, ...deps };

  const env = await readEnv(branch);
  if (!env) {
    throw new BranchNotFoundError(branch);
  }

  const wtDir = join(WORKTREES_DIR, branch);
  const composeFile = join(wtDir, "docker-compose.yml");
  const aliasSlug = env.BRANCH_SLUG || branch.toLowerCase();
  const aliases = buildPortlessAliases(aliasSlug, env);
  const urls = buildBranchUrls(aliases);

  if (options.startDatabase) {
    options.onStep?.("database:start");
    await composeUp(composeFile, env.COMPOSE_PROJECT);

    options.onStep?.("database:wait");
    await waitPg(env.DB_CONTAINER, { user: env.DB_USER, database: env.DB_NAME });
  }

  if (options.ensurePortlessProxy && !proxyRunning()) {
    options.onStep?.("portless:proxy");
    await proxyStart();
  }

  if (options.registerPortlessAliases) {
    options.onStep?.("portless:aliases");
    await regAlias(aliases.backend, env.BACKEND_PORT);
    await regAlias(aliases.frontend, env.FRONTEND_PORT);
    if (aliases.manager && env.MANAGER_PORT) {
      await regAlias(aliases.manager, env.MANAGER_PORT);
    }
  }

  return {
    env,
    wtDir,
    composeFile,
    aliasSlug,
    aliases,
    urls,
  };
}

function buildPortlessAliases(aliasSlug: string, env: WorkspaceEnv): BranchRuntime["aliases"] {
  return {
    backend: `${aliasSlug}.api.${PRODUCT_NAME}`,
    frontend: `${aliasSlug}.web.${PRODUCT_NAME}`,
    manager: env.MANAGER_PORT ? `${aliasSlug}.manager.${PRODUCT_NAME}` : undefined,
  };
}

function buildBranchUrls(aliases: BranchRuntime["aliases"]): BranchRuntime["urls"] {
  return {
    backend: `https://${aliases.backend}.localhost:${PORTLESS_PROXY_PORT}/api`,
    frontend: `https://${aliases.frontend}.localhost:${PORTLESS_PROXY_PORT}`,
    manager: aliases.manager ? `https://${aliases.manager}.localhost:${PORTLESS_PROXY_PORT}` : undefined,
  };
}
