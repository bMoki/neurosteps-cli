import { Command } from "commander";
import { startAction } from "../actions/start";

export function startCommand(): Command {
  return new Command("start")
    .description("Inicia DB + backend + frontend no Terminal")
    .argument("<branch>", "nome da branch")
    .action(async (branch) => {
      await startAction(branch);
    });
}
