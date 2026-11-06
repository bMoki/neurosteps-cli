import { Argument, Command } from "commander";
import { stopAction } from "../actions/stop";
import { SERVICE_IDS } from "../lib/config";

export function stopCommand(): Command {
  return new Command("stop")
    .description("Para todos os serviços da branch")
    .argument("[branch]", "nome da branch")
    .addArgument(new Argument("[service]", "para só este serviço; o banco e os outros continuam").choices(SERVICE_IDS))
    .option("-a, --all", "para todos os serviços de todas as branches")
    .action((branch, service, opts) => stopAction(branch, { ...opts, service }));
}
