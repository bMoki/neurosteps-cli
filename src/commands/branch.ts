import { Command } from "commander";
import { rmAction } from "../actions/rm";
import { newAction } from "../actions/new";

export function newCommand(): Command {
  return new Command("new")
    .description("Cria uma branch com worktrees configuradas (inclui manager por padrão)")
    .argument("<branch>", "nome da branch")
    .argument("[base-branch]", "branch base (default: master)")
    .option("--no-manager", "não inclui o repo manager")
    .action(async (branch, baseBranch, opts) => {
      await newAction(branch, baseBranch || "master", !opts.noManager);
    });
}

export function rmCommand(): Command {
  return new Command("rm")
    .description("Remove a worktree da branch")
    .argument("<branch>", "nome da branch")
    .option("--purge", "também remove o volume Docker")
    .option("-f, --force", "pula confirmação e força remoção de worktrees com alterações locais")
    .option("-n, --dry-run", "simula a operação sem executar")
    .action(async (branch, opts) => {
      await rmAction(branch, { purge: opts.purge || false, force: opts.force || false, dryRun: opts.dryRun || false });
    });
}
