import { Command } from "commander";
import { templateFromAction, templateToAction } from "../actions/template";

export function workspaceCommand(): Command {
  const cmd = new Command("workspace")
    .description("Gerencia workspace e templates de IDE")
    .addCommand(
      new Command("template")
        .description("Gerencia templates de configuração de IDE")
        .addCommand(
          new Command("save")
            .description("Captura config do IDE como template")
            .argument("<branch>", "nome da branch")
            .action(templateFromAction),
        )
        .addCommand(
          new Command("apply")
            .description("Aplica template do IDE na branch")
            .argument("<branch>", "nome da branch")
            .action(templateToAction),
        ),
    );

  return cmd;
}
