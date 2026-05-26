import { Command } from "commander";
import { prepareAction } from "../actions/prepare";

export function prepareCommand(): Command {
  return new Command("prepare")
    .description("Prepara DB + aliases Portless")
    .argument("<branch>", "nome da branch")
    .option("--no-manager", "não prepara o repo manager")
    .action(async (branch, opts) => {
      await prepareAction(branch, { noManager: opts.manager === false });
    });
}
