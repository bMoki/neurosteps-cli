import { join } from "path";
import {
  BACKEND_CORE_MODULE,
  PORTLESS_PROXY_PORT,
  PRODUCT_NAME,
  hasManager as defaultHasManager,
  hasReportServer as defaultHasReportServer,
  resolveBackendDir,
  resolveFrontendDir,
  resolveManagerDir,
  resolveReportServerDir,
} from "../../lib/config";
import { pathExists } from "../../lib/filesystem";
import { ensureManagementPort as defaultEnsureManagementPort } from "../../lib/ports";
import { exec } from "../../lib/shell";
import {
  type BranchRuntime,
  type BranchSetupDeps,
  type BranchSetupStep,
  setupBranchRuntime,
} from "../../actions/branch-setup";
import type { NsContext } from "../context";
import { ferramentaExterna, isNsError } from "../errors";

export type ServiceId = "backend" | "frontend" | "manager" | "report-server";

export interface PrepareInput {
  branch: string;
  withManager?: boolean;        // default: sobe o manager se a branch tiver o repo
  withReportServer?: boolean;   // default: sobe o report-server se a branch tiver o repo
  installMissingDeps: "always" | "ask" | "never";
}

/** Como subir um Serviço da branch. O núcleo só descreve; quem executa é o adapter. */
export interface ServicePlan {
  id: ServiceId;
  label: string;                        // "Backend"
  cwd: string;
  env: Record<string, string>;
  command: string;                      // "mvn -pl <core> quarkus:dev"
  port: number;                         // identidade do Serviço
}

/** Dependências que continuam faltando ao fim da operação. */
export interface MissingDep {
  id: ServiceId;
  cwd: string;
  command: string;                      // o que rodar à mão, ex.: "npm install"
  reason: "recusado" | "falhou";
}

export interface PrepareResult {
  branch: string;
  ports: { db: number; backend: number; frontend: number; manager?: number; reportServer?: number };
  urls: { backend: string; frontend: string; manager?: string; reportServer?: string };
  services: ServicePlan[];
  depsInstalled: ServiceId[];
  depsMissing: MissingDep[];
}

export interface PrepareDeps extends BranchSetupDeps {
  run: typeof exec;
  hasManager: typeof defaultHasManager;
  hasReportServer: typeof defaultHasReportServer;
  ensureManagementPort: typeof defaultEnsureManagementPort;
  depsPresent: (marker: string) => boolean;
}

const SETUP_LABELS: Record<BranchSetupStep, string> = {
  "database:start": "Iniciando PostgreSQL...",
  "database:wait": "Aguardando PostgreSQL...",
  "portless:proxy": "Iniciando proxy Portless...",
  "portless:aliases": "Registrando aliases Portless...",
};

interface DepsSpec {
  id: ServiceId;
  cwd: string;
  marker: string;               // caminho que só existe com as dependências instaladas
  install: string[];
  fallback?: string[];          // roda só se `install` lançar; também é o comando sugerido à mão
}

/**
 * Preparar e Iniciar são a mesma operação: deixa a branch pronta (banco, aliases,
 * dependências) e devolve o Plano de serviços. Subir os Serviços é do adapter.
 * Falha ao instalar dependências não aborta: fica em `depsMissing`.
 */
export async function runPrepare(
  input: PrepareInput,
  ctx: NsContext,
  deps: Partial<PrepareDeps> = {},
): Promise<PrepareResult> {
  const {
    run = exec,
    hasManager = defaultHasManager,
    hasReportServer = defaultHasReportServer,
    ensureManagementPort = defaultEnsureManagementPort,
    depsPresent = pathExists,
    ...setupDeps
  } = deps;
  const { branch } = input;

  const runtime = await setupBranchRuntime(branch, {
    startDatabase: true,
    ensurePortlessProxy: true,
    registerPortlessAliases: true,
    onStep: (step) => ctx.emit({ step, label: SETUP_LABELS[step] }),
  }, setupDeps).catch((error) => {
    if (isNsError(error)) throw error;
    throw ferramentaExterna(error instanceof Error ? error.message : String(error), {
      hint: "Confira se o Docker e o Portless estão rodando.",
      cause: error,
    });
  });
  const managementPort = await ensureManagementPort(branch, runtime.env.MANAGEMENT_PORT);

  const includeManager = input.withManager !== false && hasManager(branch);
  const includeReportServer = input.withReportServer !== false && hasReportServer(branch);

  ctx.emit({ step: "prepare:deps", label: "Verificando dependências..." });
  const depsInstalled: ServiceId[] = [];
  const depsMissing: MissingDep[] = [];
  for (const spec of depsSpecs(branch, includeManager, includeReportServer)) {
    if (depsPresent(spec.marker)) continue;

    const install = await shouldInstall(spec.id, input.installMissingDeps, ctx);
    const command = (spec.fallback ?? spec.install).join(" ");
    if (!install) {
      depsMissing.push({ id: spec.id, cwd: spec.cwd, command, reason: "recusado" });
      continue;
    }

    ctx.emit({ step: `prepare:deps:${spec.id}`, label: `Instalando dependências do ${spec.id}...` });
    if (await installDeps(spec, run)) {
      depsInstalled.push(spec.id);
      ctx.emit({ step: `prepare:deps:${spec.id}:done`, label: `Dependências do ${spec.id} instaladas` });
    } else {
      depsMissing.push({ id: spec.id, cwd: spec.cwd, command, reason: "falhou" });
    }
  }

  return {
    branch,
    ports: {
      db: runtime.env.DB_PORT,
      backend: runtime.env.BACKEND_PORT,
      frontend: runtime.env.FRONTEND_PORT,
      manager: runtime.env.MANAGER_PORT,
      reportServer: runtime.env.REPORT_SERVER_PORT,
    },
    urls: runtime.urls,
    services: buildServicePlan(branch, runtime, managementPort, includeManager, includeReportServer),
    depsInstalled,
    depsMissing,
  };
}

function depsSpecs(branch: string, includeManager: boolean, includeReportServer: boolean): DepsSpec[] {
  const npm = { install: ["npm", "ci"], fallback: ["npm", "install"] };
  const frontendDir = resolveFrontendDir(branch);
  const specs: DepsSpec[] = [
    { id: "frontend", cwd: frontendDir, marker: join(frontendDir, "node_modules/.bin/vite"), ...npm },
  ];
  if (includeManager) {
    const managerDir = resolveManagerDir(branch);
    specs.push({ id: "manager", cwd: managerDir, marker: join(managerDir, "node_modules/.bin/vite"), ...npm });
  }
  if (includeReportServer) {
    const reportServerDir = resolveReportServerDir(branch);
    specs.push({
      id: "report-server",
      cwd: reportServerDir,
      marker: join(reportServerDir, "node_modules"),
      install: ["bun", "install"],
    });
  }
  return specs;
}

async function shouldInstall(
  id: ServiceId,
  policy: PrepareInput["installMissingDeps"],
  ctx: NsContext,
): Promise<boolean> {
  if (policy === "always") return true;
  if (policy === "never") return false;
  return ctx.ask({
    id: `prepare.install-deps.${id}`,
    message: `node_modules do ${id} não encontrado. Instalar dependências agora?`,
    default: true,
    whenUnavailable: "default",
  });
}

async function installDeps(spec: DepsSpec, run: typeof exec): Promise<boolean> {
  const attempt = async (command: string[]) =>
    (await run(command, { cwd: spec.cwd, silent: true })).exitCode === 0;
  try {
    return await attempt(spec.install);
  } catch {
    if (!spec.fallback) return false;
    return attempt(spec.fallback).catch(() => false);
  }
}

function buildServicePlan(
  branch: string,
  runtime: BranchRuntime,
  managementPort: number,
  includeManager: boolean,
  includeReportServer: boolean,
): ServicePlan[] {
  const services: ServicePlan[] = [
    {
      id: "backend",
      label: "Backend",
      cwd: resolveBackendDir(branch),
      env: {
        QUARKUS_HTTP_PORT: String(runtime.env.BACKEND_PORT),
        QUARKUS_MANAGEMENT_PORT: String(managementPort),
        QUARKUS_DATASOURCE_JDBC_URL: `jdbc:postgresql://localhost:${runtime.env.DB_PORT}/${runtime.env.DB_NAME}`,
        QUARKUS_DATASOURCE_USERNAME: runtime.env.DB_USER,
        QUARKUS_DATASOURCE_PASSWORD: runtime.env.DB_PASSWORD,
        QUARKUS_PROFILE: "dev",
      },
      command: `mvn -pl ${BACKEND_CORE_MODULE} quarkus:dev`,
      port: runtime.env.BACKEND_PORT,
    },
    {
      id: "frontend",
      label: "Frontend",
      cwd: resolveFrontendDir(branch),
      env: {
        REACT_APP_API_URL: runtime.urls.backend,
        REACT_APP_WEB_URL: runtime.urls.frontend,
        REACT_APP_FRONTEND_PORT: String(runtime.env.FRONTEND_PORT),
        REACT_APP_BRANCH_NAME: branch,
        REACT_APP_PRODUCT_NAME: PRODUCT_NAME,
        REACT_APP_PORTLESS_PROXY_PORT: String(PORTLESS_PROXY_PORT),
      },
      command: "npm start",
      port: runtime.env.FRONTEND_PORT,
    },
  ];

  if (includeManager && runtime.urls.manager && runtime.env.MANAGER_PORT) {
    services.push({
      id: "manager",
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
      port: runtime.env.MANAGER_PORT,
    });
  }

  if (includeReportServer && runtime.urls.reportServer && runtime.env.REPORT_SERVER_PORT) {
    services.push({
      id: "report-server",
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
      port: runtime.env.REPORT_SERVER_PORT,
    });
  }

  return services;
}
