import { Command } from "commander";
import { prepareAction } from "../actions/prepare";

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
