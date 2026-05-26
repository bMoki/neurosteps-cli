import { Command } from "commander";
import { doctorAction } from "../actions/doctor";

export function doctorCommand(): Command {
  return new Command("doctor")
    .description("Diagnostica problemas de configuração da branch")
    .argument("<branch>", "nome da branch")
    .option("--fix", "tenta corrigir problemas automaticamente")
    .option("--no-manager", "não diagnostica o repo manager")
    .action(async (branch, opts) => {
      await doctorAction(branch, opts.fix || false, { noManager: opts.manager === false });
    });
}
