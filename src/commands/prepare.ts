import { Command } from "commander";
import { detail, emptyLine, hint, spinner, warn } from "../lib/logger";
import { createTerminalContext } from "../lib/terminal-context";
import { type PrepareDeps, type PrepareInput, type PrepareResult, runPrepare } from "../core";

export function prepareCommand(): Command {
  return new Command("prepare")
    .description("Prepara DB + aliases Portless")
    .argument("<branch>", "nome da branch")
    .option("--no-manager", "não prepara o repo manager")
    .option("--no-report-server", "não prepara o repo report-server")
    .action(async (branch, opts) => {
      await prepareAction(branch, { noManager: opts.manager === false, noReportServer: opts.reportServer === false });
    });
}

export type PrepareActionDeps = Partial<PrepareDeps>;

export async function prepareAction(
  branch: string,
  opts: { noManager?: boolean; noReportServer?: boolean } = {},
  deps: PrepareActionDeps = {},
): Promise<void> {
  const s = spinner(`Preparando ${branch}...`).start();

  const result = await runPrepareInTerminal(s, {
    branch,
    withManager: !opts.noManager,
    withReportServer: !opts.noReportServer,
    installMissingDeps: "always",
  }, deps);

  s.succeed(`Branch ${branch} preparada`);
  emptyLine();
  detail("DB", `localhost:${result.ports.db}`);
  printUrls(result);
  emptyLine();
  hint(`Próximo passo: ns open ${branch}   # abrir no IDE`);
}

/** Roda a operação com spinner e prompt, e avisa das dependências que ficaram faltando. */
export async function runPrepareInTerminal(
  s: ReturnType<typeof spinner>,
  input: PrepareInput,
  deps: PrepareActionDeps,
): Promise<PrepareResult> {
  const result = await runPrepare(input, createTerminalContext(s), deps).catch((error) => {
    s.fail(error instanceof Error ? error.message : String(error));
    throw error;
  });

  warnMissingDeps(result);
  return result;
}

export function warnMissingDeps(result: PrepareResult): void {
  for (const missing of result.depsMissing) {
    if (missing.reason === "falhou") warn(`Falha ao instalar dependências do ${missing.id}`);
    if (missing.reason === "divergente") {
      warn(`As dependências do ${missing.id} são as da master e diferem das da branch; ela pode não funcionar`);
    }
    warn(`Rode manualmente: ${missing.command} em ${missing.cwd}`);
  }
}

export function printUrls(result: PrepareResult): void {
  detail("Backend", result.urls.backend);
  detail("Frontend", result.urls.frontend);
  if (result.urls.manager) {
    detail("Manager", result.urls.manager);
  }
  if (result.urls.reportServer) {
    detail("Report-server", result.urls.reportServer);
  }
}
