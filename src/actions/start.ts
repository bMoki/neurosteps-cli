import {
  resolveBackendDir,
  resolveFrontendDir,
  resolveManagerDir,
  resolveReportServerDir,
  hasManager,
  hasReportServer,
  PRODUCT_NAME,
  PORTLESS_PROXY_PORT,
  BACKEND_CORE_MODULE,
} from "../lib/config";
import { formatShellCommand, spawnTerminal, exec } from "../lib/shell";
import { detail, emptyLine, hint, spinner, warn } from "../lib/logger";
import { pathExists } from "../lib/filesystem";
import { join } from "path";
import { confirm } from "@inquirer/prompts";
import { openAiApp } from "../lib/apps";
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
  branchHasReportServer?: typeof hasReportServer;
  aiFlag?: string;
  noManager?: boolean;
  noReportServer?: boolean;
}

export async function startAction(branch: string, deps: StartActionDeps = {}): Promise<void> {
  const {
    spawnTerm = spawnTerminal,
    branchHasManager = hasManager,
    branchHasReportServer = hasReportServer,
    aiFlag,
    noManager = false,
    noReportServer = false,
    ...setupDeps
  } = deps;
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
    s.fail(error instanceof Error ? error.message : String(error));
    throw error;
  });

  s.text = "Verificando dependências...";
  const frontendDir = resolveFrontendDir(branch);
  const frontendNodeModules = join(frontendDir, "node_modules/.bin/vite");
  if (!pathExists(frontendNodeModules)) {
    warn("node_modules do frontend não encontrado");
    if (process.stdout.isTTY) {
      const shouldInstall = await confirm({
        message: "Instalar dependências do frontend agora?",
        default: true,
      });
      if (shouldInstall) {
        s.text = "Instalando dependências do frontend...";
        const result = await exec(["npm", "ci"], { cwd: frontendDir, silent: true }).catch(() =>
          exec(["npm", "install"], { cwd: frontendDir, silent: true }),
        );
        if (result.exitCode === 0) {
          s.text = "Dependências do frontend instaladas";
        } else {
          warn("Falha ao instalar dependências do frontend");
          warn("Rode manualmente: npm install em " + frontendDir);
        }
      }
    } else {
      hint("Rode manualmente: npm install em " + frontendDir);
    }
  }
  if (!noManager && branchHasManager(branch)) {
    const managerDir = resolveManagerDir(branch);
    const managerNodeModules = join(managerDir, "node_modules/.bin/vite");
    if (!pathExists(managerNodeModules)) {
      warn("node_modules do manager não encontrado");
      if (process.stdout.isTTY) {
        const shouldInstall = await confirm({
          message: "Instalar dependências do manager agora?",
          default: true,
        });
        if (shouldInstall) {
          s.text = "Instalando dependências do manager...";
          const result = await exec(["npm", "ci"], { cwd: managerDir, silent: true }).catch(() =>
            exec(["npm", "install"], { cwd: managerDir, silent: true }),
          );
          if (result.exitCode === 0) {
            s.text = "Dependências do manager instaladas";
          } else {
            warn("Falha ao instalar dependências do manager");
            warn("Rode manualmente: npm install em " + managerDir);
          }
        }
      } else {
        hint("Rode manualmente: npm install em " + managerDir);
      }
    }
  }

  if (!noReportServer && branchHasReportServer(branch)) {
    const reportServerDir = resolveReportServerDir(branch);
    if (!pathExists(join(reportServerDir, "node_modules"))) {
      warn("node_modules do report-server não encontrado");
      if (process.stdout.isTTY) {
        const shouldInstall = await confirm({
          message: "Instalar dependências do report-server agora?",
          default: true,
        });
        if (shouldInstall) {
          s.text = "Instalando dependências do report-server...";
          const result = await exec(["bun", "install"], { cwd: reportServerDir, silent: true });
          if (result.exitCode === 0) {
            s.text = "Dependências do report-server instaladas";
          } else {
            warn("Falha ao instalar dependências do report-server");
            warn("Rode manualmente: bun install em " + reportServerDir);
          }
        }
      } else {
        hint("Rode manualmente: bun install em " + reportServerDir);
      }
    }
  }

  s.text = "Abrindo terminais...";
  const services = buildStartServices(
    branch,
    runtime,
    !noManager && branchHasManager(branch),
    !noReportServer && branchHasReportServer(branch),
  );
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
  if (runtime.urls.reportServer) {
    detail("Report-server", runtime.urls.reportServer);
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

  if (aiFlag) {
    try {
      s.text = `Abrindo ${aiFlag}...`;
      await openAiApp(aiFlag, resolveBackendDir(branch));
      detail("AI", aiFlag + " aberto");
    } catch (error) {
      warn(`Não foi possível abrir ${aiFlag}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  emptyLine();
  hint(`Próximo passo: ns status ${branch}  # ver status dos serviços`);
}

function buildStartServices(
  branch: string,
  runtime: BranchRuntime,
  includeManager: boolean,
  includeReportServer: boolean,
): StartServiceCommand[] {
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
      command: `mvn -pl ${BACKEND_CORE_MODULE} quarkus:dev`,
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

  if (includeReportServer && runtime.urls.reportServer && runtime.env.REPORT_SERVER_PORT) {
    services.push({
      label: "Report-server",
      cwd: resolveReportServerDir(branch),
      env: {
        PORT: String(runtime.env.REPORT_SERVER_PORT),
        APP_URL: runtime.urls.reportServer,
        WEB_URL: runtime.urls.frontend,
        API_URL: runtime.urls.backend,
        BRANCH_NAME: branch,
        PRODUCT_NAME,
        PORTLESS_PROXY_PORT: String(PORTLESS_PROXY_PORT),
      },
      command: "bun run dev",
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
