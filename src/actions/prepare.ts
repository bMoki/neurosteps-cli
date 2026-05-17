import { detail, emptyLine, spinner } from "../lib/logger";
import {
  BranchNotFoundError,
  type BranchSetupDeps,
  setupBranchRuntime,
} from "./branch-setup";

export async function prepareAction(
  branch: string,
  deps: Partial<BranchSetupDeps> = {},
): Promise<void> {
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
    if (error instanceof BranchNotFoundError) {
      s.fail(error.message);
      process.exit(1);
    }
    throw error;
  });

  s.succeed(`Branch ${branch} preparada`);
  emptyLine();
  detail("DB", `localhost:${runtime.env.DB_PORT}`);
  detail("Backend", runtime.urls.backend);
  detail("Frontend", runtime.urls.frontend);
  if (runtime.urls.manager) {
    detail("Manager", runtime.urls.manager);
  }
}
