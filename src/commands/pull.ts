import { Command } from "commander";
import { pullAction } from "../actions/pull";

export function pullCommand(): Command {
  return new Command("pull")
    .description("Roda git pull em todos os repos da branch (@default = branch principal de cada repo)")
    .argument("[remote]", "remoto do git", "origin")
    .argument("[branch]", "branch a puxar (@default resolve main/master por repo)", "@default")
    .option("-b, --branch <worktree>", "branch de workspace (padrão: inferida do diretório atual)")
    .action((remote: string, branch: string, opts: { branch?: string }) => pullAction(remote, branch, opts));
}
