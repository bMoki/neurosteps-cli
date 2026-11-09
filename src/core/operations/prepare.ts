import { join, relative } from "path";
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
  resolveServiceLogFile,
  resolveServiceSession,
  type SERVICE_IDS,
  WORKTREES_DIR,
} from "../../lib/config";
import { type PackageManager, installedMatchesLockfile as defaultInstalledMatchesLockfile } from "../../lib/deps";
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
import { ferramentaExterna, isNsError, naoEncontrado } from "../errors";

export type ServiceId = (typeof SERVICE_IDS)[number];

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
  session: string;                      // sessão tmux onde o Serviço roda
  logFile: string;                      // saída gravada da execução atual
}

/** Dependências que continuam faltando, ou diferentes do declarado, ao fim da operação. */
export interface MissingDep {
  id: ServiceId;
  cwd: string;
  command: string;                      // o que rodar à mão, ex.: "npm install"
  reason: "recusado" | "falhou" | "divergente";   // divergente: ficou com as da master
}

export interface PrepareResult {
  branch: string;
  ports: { db: number; backend: number; frontend: number; manager?: number; reportServer?: number };
  urls: { backend: string; frontend: string; manager?: string; reportServer?: string };
  services: ServicePlan[];
  depsInstalled: ServiceId[];
  depsReused: ServiceId[];              // vieram da master
  depsMissing: MissingDep[];
}

export interface PrepareDeps extends BranchSetupDeps {
  run: typeof exec;
  hasManager: typeof defaultHasManager;
  hasReportServer: typeof defaultHasReportServer;
  ensureManagementPort: typeof defaultEnsureManagementPort;
  depsPresent: (marker: string) => boolean;
  installedMatchesLockfile: typeof defaultInstalledMatchesLockfile;
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
  packageManager: PackageManager;
}

/**
 * A Branch de workspace de onde as dependências são reaproveitadas. É a pasta da
 * worktree `master`, não a Branch principal (`@default`) de cada Repo.
 */
const DEPS_SOURCE_BRANCH = "master";

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
    installedMatchesLockfile = defaultInstalledMatchesLockfile,
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
  const depsReused: ServiceId[] = [];
  const depsMissing: MissingDep[] = [];
  for (const spec of depsSpecs(branch, includeManager, includeReportServer)) {
    if (depsPresent(spec.marker)) continue;

    if (branch !== DEPS_SOURCE_BRANCH && await reuseDeps(branch, spec, run, depsPresent, ctx)) {
      depsReused.push(spec.id);
      if (installedMatchesLockfile(spec.cwd, spec.packageManager)) continue;

      const outcome = await installDifferences(spec, input.installMissingDeps, run, ctx);
      if (outcome === "instaladas") depsInstalled.push(spec.id);
      else depsMissing.push(outcome);
      continue;
    }

    const install = await shouldInstall(input.installMissingDeps, ctx, {
      id: `prepare.install-deps.${spec.id}`,
      message: `node_modules do ${spec.id} não encontrado. Instalar dependências agora?`,
    });
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
    depsReused,
    depsMissing,
  };
}

/**
 * Os Serviços do Plano a subir: todos, ou só `service`. Pedir um Serviço que a branch
 * não tem é nao-encontrado.
 */
export function servicesToStart(result: PrepareResult, service?: ServiceId): ServicePlan[] {
  if (!service) return result.services;
  const planned = result.services.filter(({ id }) => id === service);
  if (planned.length === 0) {
    throw naoEncontrado(`A branch '${result.branch}' não tem o Serviço ${service}`);
  }
  return planned;
}

function depsSpecs(branch: string, includeManager: boolean, includeReportServer: boolean): DepsSpec[] {
  const npm = { install: ["npm", "ci"], fallback: ["npm", "install"], packageManager: "npm" as const };
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
      packageManager: "bun",
    });
  }
  return specs;
}

async function shouldInstall(
  policy: PrepareInput["installMissingDeps"],
  ctx: NsContext,
  question: { id: string; message: string },
): Promise<boolean> {
  if (policy === "always") return true;
  if (policy === "never") return false;
  return ctx.ask({ ...question, default: true, whenUnavailable: "default" });
}

/**
 * Clona o `node_modules` do Repo na master para a branch. A pasta é a da worktree da
 * master, nunca a do Repo base, que é para onde os `resolve*Dir` caem sem worktree;
 * pelo mesmo motivo, o destino tem de ser a worktree da própria branch. O clone do
 * APFS só ocupa espaço quando um arquivo muda. Reaproveita só se a branch não tem
 * `node_modules` nenhum, para nunca mexer numa instalação existente. Copia para uma
 * pasta temporária e renomeia, para uma falha não deixar meio `node_modules` para trás.
 */
async function reuseDeps(
  branch: string,
  target: DepsSpec,
  run: typeof exec,
  depsPresent: PrepareDeps["depsPresent"],
  ctx: NsContext,
): Promise<boolean> {
  const sourceDir = join(WORKTREES_DIR, DEPS_SOURCE_BRANCH, target.id);
  if (target.cwd !== join(WORKTREES_DIR, branch, target.id)) return false;
  const from = join(sourceDir, "node_modules");
  const to = join(target.cwd, "node_modules");
  if (!depsPresent(join(sourceDir, relative(target.cwd, target.marker))) || depsPresent(to)) return false;

  ctx.emit({ step: `prepare:deps:${target.id}:reuse`, label: `Reaproveitando as dependências do ${target.id} da master...` });
  const staging = `${to}.ns-reuse`;
  const steps = [["rm", "-rf", staging], ["cp", "-cR", from, staging], ["mv", staging, to]];
  for (const command of steps) {
    if (!await succeeds(run, command)) {
      await succeeds(run, ["rm", "-rf", staging]);
      return false;
    }
  }
  return true;
}

/**
 * Instala o que o lockfile da branch declara por cima do `node_modules` vindo da master,
 * se a política deixar. Recusado, a branch fica com as dependências da master.
 */
async function installDifferences(
  spec: DepsSpec,
  policy: PrepareInput["installMissingDeps"],
  run: typeof exec,
  ctx: NsContext,
): Promise<"instaladas" | MissingDep> {
  const update = [spec.packageManager, "install"];
  const missing = (reason: MissingDep["reason"]): MissingDep =>
    ({ id: spec.id, cwd: spec.cwd, command: update.join(" "), reason });

  const install = await shouldInstall(policy, ctx, {
    id: `prepare.update-reused-deps.${spec.id}`,
    message: `As dependências do ${spec.id} diferem da master. Instalar as diferenças agora?`,
  });
  if (!install) return missing("divergente");

  ctx.emit({ step: `prepare:deps:${spec.id}`, label: `Instalando as diferenças do ${spec.id}...` });
  if (!await succeeds(run, update, spec.cwd)) return missing("falhou");
  ctx.emit({ step: `prepare:deps:${spec.id}:done`, label: `Dependências do ${spec.id} instaladas` });
  return "instaladas";
}

/** Roda o comando e diz se saiu com 0; um comando que nem roda conta como falha. */
async function succeeds(run: typeof exec, command: string[], cwd?: string): Promise<boolean> {
  return run(command, { cwd, silent: true }).then(({ exitCode }) => exitCode === 0, () => false);
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
  const services: Omit<ServicePlan, "session" | "logFile">[] = [
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

  return services.map((service) => ({
    ...service,
    session: resolveServiceSession(runtime.aliasSlug, service.id),
    logFile: resolveServiceLogFile(branch, service.id),
  }));
}
