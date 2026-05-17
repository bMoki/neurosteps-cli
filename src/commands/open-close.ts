import { Command } from "commander";
import { openAction } from "../actions/open";
import { closeAction } from "../actions/close";

export function openCommand(): Command {
  return new Command("open")
    .description("Abre a branch no IDE e prepara serviços")
    .argument("<branch>", "nome da branch")
    .option("--no-prepare", "pula setup de DB + Portless")
    .option("--app <name>", "abre no app especificado (ex: vscode, intellij)")
    .action(async (branch, opts) => {
      await openAction(branch, {
        prepare: opts.prepare !== false,
        app: opts.app,
      });
    });
}

export function closeCommand(): Command {
  return new Command("close")
    .description("Para serviços e fecha a janela do IDE")
    .argument("<branch>", "nome da branch")
    .option("--app <name>", "fecha o app especificado (ex: vscode, intellij)")
    .action(async (branch, opts) => {
      await closeAction(branch, {
        app: opts.app,
      });
    });
}
