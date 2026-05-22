import {
  resolveBackendDir,
  resolveFrontendDir,
  resolveManagerDir,
  hasManager,
  PRODUCT_NAME,
  PORTLESS_PROXY_PORT,
  BACKEND_MODULE,
} from "../lib/config";
import { formatShellCommand, spawnTerminal } from "../lib/shell";
import { detail, emptyLine, hint, spinner, warn } from "../lib/logger";
import {
  BranchNotFoundError,
  setupBranchRuntime,
  type BranchRuntime,
  type BranchSetupDeps,
} from "./branch-setup";

interface StartServiceCommand {
  label: string;
  cwd: string;
  env: Record<string, string>;
  command: string;
}

interface TerminalOpenResult {
  opened: number;
  error?: unknown;
}

export interface StartActionDeps extends Partial<BranchSetupDeps> {
  spawnTerm?: typeof spawnTerminal;
  branchHasManager?: typeof hasManager;
}

export async function startAction(branch: string, deps: StartActionDeps = {}): Promise<void> {
  const { spawnTerm = spawnTerminal, branchHasManager = hasManager, ...setupDeps } = deps;
  const s = spinner(`Iniciando ${branch}...`).start();

  const runtime = await setupBranchRuntime(branch, {
    startDatabase: true,
    ensurePortlessProxy: true,
    registerPortlessAliases: true,
    onStep: (step) => {
      if (step === "database:start") s.text = "Iniciando PostgreSQL...";
      if (step === "database:wait") s.text = "Aguardando PostgreSQL...";
      if (step === "portless:proxy") s.text = "Iniciando proxy Portless...";
      if (step === "portless:aliases") s.text = "Registrando aliases Portless...";
    },
  }, setupDeps).catch((error) => {
    if (error instanceof BranchNotFoundError) {
      s.fail(error.message);
      process.exit(1);
    }
    throw error;
  });

  s.text = "Abrindo terminais...";
  const services = buildStartServices(branch, runtime, branchHasManager(branch));
  const terminalResult = await openServiceTerminals(services, spawnTerm);

  if (terminalResult.error) {
    s.stop();
    warn(`Terminal.app não abriu automaticamente para ${branch}`);
  } else {
    s.succeed(`Serviços iniciados para ${branch}`);
  }

  emptyLine();
  detail("Backend", runtime.urls.backend);
  detail("Frontend", runtime.urls.frontend);
  if (runtime.urls.manager) {
    detail("Manager", runtime.urls.manager);
  }

  if (terminalResult.error) {
    emptyLine();
    detail("Terminais abertos", terminalResult.opened);
    hint(`Motivo: ${summarizeTerminalError(terminalResult.error)}`);
    hint("DB e aliases Portless foram preparados. Para subir os serviços, rode manualmente:");
    emptyLine();
    for (const service of services) {
      detail(service.label, formatShellCommand(service.cwd, service.env, service.command));
    }
  }

  emptyLine();
  hint(`Próximo passo: ns status ${branch}  # ver status dos serviços`);
}

function buildStartServices(branch: string, runtime: BranchRuntime, includeManager: boolean): StartServiceCommand[] {
  const backendDir = resolveBackendDir(branch);
  const frontendDir = resolveFrontendDir(branch);
  const services: StartServiceCommand[] = [
    {
      label: "Backend",
      cwd: backendDir,
      env: {
        QUARKUS_HTTP_PORT: String(runtime.env.BACKEND_PORT),
        QUARKUS_DATASOURCE_JDBC_URL: `jdbc:postgresql://localhost:${runtime.env.DB_PORT}/${runtime.env.DB_NAME}`,
        QUARKUS_DATASOURCE_USERNAME: runtime.env.DB_USER,
        QUARKUS_DATASOURCE_PASSWORD: runtime.env.DB_PASSWORD,
        QUARKUS_PROFILE: "dev",
      },
      command: `mvn -pl ${BACKEND_MODULE}-core quarkus:dev`,
    },
    {
      label: "Frontend",
      cwd: frontendDir,
      env: {
        REACT_APP_API_URL: runtime.urls.backend,
        REACT_APP_WEB_URL: runtime.urls.frontend,
        REACT_APP_FRONTEND_PORT: String(runtime.env.FRONTEND_PORT),
        REACT_APP_BRANCH_NAME: branch,
        REACT_APP_PRODUCT_NAME: PRODUCT_NAME,
        REACT_APP_PORTLESS_PROXY_PORT: String(PORTLESS_PROXY_PORT),
      },
      command: "npm start",
    },
  ];

  if (includeManager && runtime.urls.manager && runtime.env.MANAGER_PORT) {
    services.push({
      label: "Manager",
      cwd: resolveManagerDir(branch),
      env: {
        VITE_APP_URL: runtime.urls.manager,
        VITE_WEB_URL: runtime.urls.frontend,
        VITE_API_URL: runtime.urls.backend,
        PORT: String(runtime.env.MANAGER_PORT),
        VITE_BRANCH_NAME: branch,
        VITE_PRODUCT_NAME: PRODUCT_NAME,
        VITE_PORTLESS_PROXY_PORT: String(PORTLESS_PROXY_PORT),
      },
      command: "npm run dev",
    });
  }

  return services;
}

async function openServiceTerminals(
  services: StartServiceCommand[],
  spawnTerm: typeof spawnTerminal,
): Promise<TerminalOpenResult> {
  let opened = 0;

  for (const service of services) {
    try {
      await spawnTerm(service.cwd, service.env, service.command);
      opened += 1;
    } catch (error) {
      return { opened, error };
    }
  }

  return { opened };
}

function summarizeTerminalError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const firstLine = message.split("\n")[0]?.trim() || "erro desconhecido";
  return firstLine.replace(/: osascript .*/, "");
}
