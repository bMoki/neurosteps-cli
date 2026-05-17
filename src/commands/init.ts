import { Command } from "commander";
import { initAction } from "../actions/init";

export function initCommand(): Command {
  return new Command("init")
    .description("Configura a CLI e cria diretórios/templates base do workspace")
    .option("--reconfig", "reconfigura envs existentes")
    .action(async (opts) => {
      await initAction({ reconfig: opts.reconfig });
    });
}
