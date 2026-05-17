import { Command } from "commander";
import { ok, spinner } from "../lib/logger";
import { BranchNotFoundError, setupBranchRuntime } from "../actions/branch-setup";

export function portlessCommand(): Command {
  return new Command("portless")
    .description("Registra aliases Portless para uma branch")
    .argument("<branch>", "nome da branch")
    .action(async (branch) => {
      const s = spinner(`Registrando aliases Portless para ${branch}...`).start();

      const runtime = await setupBranchRuntime(branch, {
        ensurePortlessProxy: true,
        registerPortlessAliases: true,
        onStep: (step) => {
          if (step === "portless:proxy") s.text = "Iniciando proxy Portless...";
          if (step === "portless:aliases") s.text = "Registrando aliases Portless...";
        },
      }).catch((error) => {
        if (error instanceof BranchNotFoundError) {
          s.fail(error.message);
          process.exit(1);
        }
        throw error;
      });

      s.succeed(`Aliases Portless registrados para ${branch}`);
      ok(`Backend: ${runtime.aliases.backend}`);
      ok(`Frontend: ${runtime.aliases.frontend}`);
      if (runtime.aliases.manager) {
        ok(`Manager: ${runtime.aliases.manager}`);
      }
    });
}
