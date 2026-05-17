import { Command } from "commander";
import { prepareAction } from "../actions/prepare";

export function prepareCommand(): Command {
  return new Command("prepare")
    .description("Prepara DB + aliases Portless")
    .argument("<branch>", "nome da branch")
    .action(prepareAction);
}
