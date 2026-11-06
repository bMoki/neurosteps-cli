import { join } from "path";
import { appDisplayName } from "../../lib/apps";
import { markBranchTouched } from "../../lib/branch-flags";
import { WORKTREES_DIR, branchExists as defaultBranchExists } from "../../lib/config";
import { getSetting } from "../../lib/settings";
import { openApp as defaultOpenApp } from "../../lib/shell";
import type { NsContext } from "../context";
import { asNsError, naoEncontrado, preCondicao } from "../errors";

export interface DbOpenInput {
  branch: string;
  app?: string;   // default: o `databaseApp` configurado no ns
}

export interface DbOpenResult {
  branch: string;
  app: string;    // nome do app aberto, como o macOS o conhece
}

export interface DbOpenDeps {
  branchExists: typeof defaultBranchExists;
  configuredApp: () => Promise<string | undefined>;
  openApp: typeof defaultOpenApp;
  markTouched: typeof markBranchTouched;
}

const defaultDeps: DbOpenDeps = {
  branchExists: defaultBranchExists,
  configuredApp: () => getSetting("databaseApp"),
  openApp: defaultOpenApp,
  markTouched: markBranchTouched,
};

/** Abrir no app de banco: abre a Branch de workspace no app de banco (DataGrip ou o configurado no ns). */
export async function runDbOpen(input: DbOpenInput, _ctx: NsContext, deps: Partial<DbOpenDeps> = {}): Promise<DbOpenResult> {
  const d = { ...defaultDeps, ...deps };
  const { branch } = input;
  if (!d.branchExists(branch)) {
    throw naoEncontrado(`Branch '${branch}' não encontrada`, "Rode 'ns status' para ver as branches disponíveis.");
  }
  const key = input.app ?? (await d.configuredApp());
  if (!key) {
    throw preCondicao(
      "Nenhum app de banco configurado no ns.",
      "Rode 'ns config set databaseApp datagrip' (ou tableplus, dbeaver), ou 'ns db open <branch>' no terminal para escolher.",
    );
  }

  const app = appDisplayName(key);
  await d.markTouched(branch, "open-db");
  await d.openApp(app, join(WORKTREES_DIR, branch)).catch((error) => { throw asNsError(error); });
  return { branch, app };
}
