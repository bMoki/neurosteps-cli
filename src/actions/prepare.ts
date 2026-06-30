import { detail, emptyLine, hint, spinner, warn } from "../lib/logger";
import {
  BranchNotFoundError,
  type BranchSetupDeps,
  setupBranchRuntime,
} from "./branch-setup";
import { resolveFrontendDir, resolveManagerDir, resolveReportServerDir, hasManager, hasReportServer } from "../lib/config";
import { pathExists } from "../lib/filesystem";
import { exec } from "../lib/shell";
import { join } from "path";

export async function prepareAction(
  branch: string,
  opts: { noManager?: boolean; noReportServer?: boolean } = {},
  deps: Partial<BranchSetupDeps> = {},
): Promise<void> {
  const { noManager = false, noReportServer = false } = opts;
  const s = spinner(`Preparando ${branch}...`).start();

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
  }, deps).catch((error) => {
    s.fail(error instanceof Error ? error.message : String(error));
    throw error;
  });

  s.text = "Verificando dependências...";
  const frontendDir = resolveFrontendDir(branch);
  const frontendNodeModules = join(frontendDir, "node_modules/.bin/vite");
  if (!pathExists(frontendNodeModules)) {
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
  if (!noManager && hasManager(branch)) {
    const managerDir = resolveManagerDir(branch);
    const managerNodeModules = join(managerDir, "node_modules/.bin/vite");
    if (!pathExists(managerNodeModules)) {
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
  }
  if (!noReportServer && hasReportServer(branch)) {
    const reportServerDir = resolveReportServerDir(branch);
    if (!pathExists(join(reportServerDir, "node_modules"))) {
      s.text = "Instalando dependências do report-server...";
      const result = await exec(["bun", "install"], { cwd: reportServerDir, silent: true });
      if (result.exitCode === 0) {
        s.text = "Dependências do report-server instaladas";
      } else {
        warn("Falha ao instalar dependências do report-server");
        warn("Rode manualmente: bun install em " + reportServerDir);
      }
    }
  }

  s.succeed(`Branch ${branch} preparada`);
  emptyLine();
  detail("DB", `localhost:${runtime.env.DB_PORT}`);
  detail("Backend", runtime.urls.backend);
  detail("Frontend", runtime.urls.frontend);
  if (runtime.urls.manager) {
    detail("Manager", runtime.urls.manager);
  }
  if (runtime.urls.reportServer) {
    detail("Report-server", runtime.urls.reportServer);
  }
  emptyLine();
  hint(`Próximo passo: ns open ${branch}   # abrir no IDE`);
}
