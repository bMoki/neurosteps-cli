import { Command } from "commander";
import { addManagerAction } from "../actions/add";

export function addCommand(): Command {
  return new Command("add")
    .description("Adiciona componentes a uma workspace existente")
    .addCommand(
      new Command("manager")
        .description("Adiciona o repo manager a uma workspace existente")
        .argument("<branch>", "nome da branch/workspace")
        .option("--base <branch>", "branch base quando a branch não existe no manager", "master")
        .option("--port <port>", "porta do manager")
        .action(async (branch, opts) => {
          await addManagerAction(branch, opts);
        }),
    );
}
