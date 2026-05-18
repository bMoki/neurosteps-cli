import { WORKTREES_DIR } from "../lib/config";
import { resolveDatabaseApp, ensureDatabaseAppConfigured } from "../lib/apps";
import { openApp } from "../lib/shell";
import { error } from "../lib/logger";
import { join } from "path";

const DB_APP_DISPLAY_NAMES: Record<string, string> = {
  datagrip: "DataGrip",
  tableplus: "TablePlus",
  dbeaver: "DBeaver",
};

export async function openDbAction(branch: string, appKey?: string): Promise<void> {
  const wtDir = join(WORKTREES_DIR, branch);
  const file = Bun.file(wtDir);
  if (!(await file.exists())) {
    error(`Branch não encontrada: ${branch}`);
    process.exitCode = 1;
    return;
  }

  const resolvedKey = appKey ?? (await ensureDatabaseAppConfigured());
  await resolveDatabaseApp();

  const appName = DB_APP_DISPLAY_NAMES[resolvedKey] ?? resolvedKey;
  await openApp(appName, wtDir);
}
