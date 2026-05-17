import { openApp } from "../lib/shell";
import { detail, emptyLine, spinner } from "../lib/logger";
import { resolveAppPath, ensureDefaultIdeConfigured, appDisplayName } from "../lib/apps";
import { join } from "path";
import { BranchNotFoundError, setupBranchRuntime } from "./branch-setup";

export async function openAction(branch: string, opts: { prepare: boolean; app?: string }): Promise<void> {
  const s = spinner(`Abrindo ${branch}...`).start();

  const runtime = await setupBranchRuntime(branch, {
    startDatabase: opts.prepare,
    ensurePortlessProxy: true,
    registerPortlessAliases: opts.prepare,
    onStep: (step) => {
      if (step === "database:start") s.text = "Iniciando PostgreSQL...";
      if (step === "database:wait") s.text = "Aguardando PostgreSQL...";
      if (step === "portless:proxy") s.text = "Iniciando proxy Portless...";
      if (step === "portless:aliases") s.text = "Registrando aliases Portless...";
    },
  }).catch((error) => {
    if (error instanceof BranchNotFoundError) {
      s.fail(error.message);
      process.exit(1);
    }
    throw error;
  });

  let appKey = opts.app;
  if (!appKey) {
    appKey = await ensureDefaultIdeConfigured();
  }

  const appName = appDisplayName(appKey);
  s.text = `Abrindo no ${appName}...`;

  const appPath = await resolveAppPath(appKey);

  if (appKey === "intellij" || appKey === "idea" || appKey === "webstorm") {
    await openApp(appPath || "IntelliJ IDEA.app", runtime.wtDir);
  } else {
    const workspaceFile = join(runtime.wtDir, `${branch}.code-workspace`);
    await openApp(appPath || "Visual Studio Code.app", workspaceFile);
  }

  s.succeed(`${branch} aberta no ${appName}`);
  emptyLine();
  detail("Workspace", runtime.wtDir);
  detail("Frontend", runtime.urls.frontend);
}
