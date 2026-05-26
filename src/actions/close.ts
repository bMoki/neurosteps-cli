import { execChecked } from "../lib/shell";
import { spinner } from "../lib/logger";
import { resolveDefaultIde, resolveAppPath, appDisplayName } from "../lib/apps";
import {
  type BranchShutdownDeps,
  BranchShutdownNotFoundError,
  defaultBranchShutdownDeps,
  shutdownBranchRuntime,
} from "./branch-shutdown";

interface CloseDeps extends BranchShutdownDeps {
  execChecked: typeof execChecked;
  resolveDefaultIde: typeof resolveDefaultIde;
  resolveAppPath: typeof resolveAppPath;
  appDisplayName: typeof appDisplayName;
}

const defaultCloseDeps: CloseDeps = {
  ...defaultBranchShutdownDeps,
  execChecked,
  resolveDefaultIde,
  resolveAppPath,
  appDisplayName,
};

export async function closeAction(
  branch: string,
  opts: { app?: string } = {},
  deps: Partial<CloseDeps> = {},
): Promise<void> {
  const {
    execChecked: runChecked,
    resolveDefaultIde: resolveDefault,
    resolveAppPath: resolvePath,
    appDisplayName: displayName,
    ...shutdownDeps
  } = { ...defaultCloseDeps, ...deps };
  const s = spinner(`Fechando ${branch}...`).start();

  try {
    await shutdownBranchRuntime(branch, {
      onStep: (step) => {
        if (step === "database:stop") s.text = "Parando PostgreSQL...";
        if (step === "portless:aliases") s.text = "Removendo aliases Portless...";
        if (step === "processes:stop") s.text = "Encerrando processos...";
      },
    }, shutdownDeps);
  } catch (error) {
    if (error instanceof BranchShutdownNotFoundError) {
      s.fail(error.message);
      process.exit(1);
    }
    throw error;
  }

  let appKey = opts.app;
  if (!appKey) {
    appKey = await resolveDefault();
  }

  const appName = displayName(appKey);
  const appPath = await resolvePath(appKey);
  const ideDisplayName = appPath ? appPath.split("/").pop()?.replace(".app", "") || appName : appName;

  const script = closeMatchingWindowsScript(ideDisplayName, branch);
  await runChecked(["osascript", "-e", script], { silent: true }, `fechar janelas do ${ideDisplayName} no macOS`);

  s.succeed(`${branch} fechada no ${appName}`);
}

function closeMatchingWindowsScript(appName: string, branch: string): string {
  const app = quoteAppleScriptString(appName);
  const windowName = quoteAppleScriptString(branch);

  return `if application ${app} is running then
  tell application ${app}
    repeat with matchingWindow in (every window whose name contains ${windowName})
      close matchingWindow
    end repeat
  end tell
end if`;
}

function quoteAppleScriptString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
