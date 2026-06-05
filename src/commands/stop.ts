import { Command } from "commander";
import { stopAction } from "../actions/stop";

export function stopCommand(): Command {
  return new Command("stop")
    .description("Para todos os serviços da branch")
    .argument("[branch]", "nome da branch")
    .option("-a, --all", "para todos os serviços de todas as branches")
    .action(stopAction);
}
