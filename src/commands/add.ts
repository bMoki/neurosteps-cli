import { Command, InvalidArgumentError } from "commander";
import { detail, emptyLine, section, spinner } from "../lib/logger";
import { createTerminalContext, stopSpinnerOnError } from "../lib/terminal-context";
import { type AddRepoDeps, type AddableRepo, repoLabel, runAddRepo } from "../core";

const SUBCOMMANDS: Array<{ repo: AddableRepo; description: string; withPort: boolean }> = [
  { repo: "manager", description: "Adiciona o repo manager a uma workspace existente", withPort: true },
  { repo: "docs", description: "Adiciona o repo docs a uma workspace existente", withPort: false },
  { repo: "report-server", description: "Adiciona o repo report-server a uma workspace existente", withPort: true },
  { repo: "parents", description: "Adiciona o repo scalemed-parents a uma workspace existente", withPort: false },
];

export function addCommand(): Command {
  const command = new Command("add").description("Adiciona componentes a uma workspace existente");
  for (const { repo, description, withPort } of SUBCOMMANDS) {
    const sub = new Command(repo)
      .description(description)
      .argument("<branch>", "nome da branch/workspace")
      .option("--base <branch>", `branch base quando a branch não existe no ${repo} (default: a do repo)`);
    if (withPort) sub.option("--port <port>", `porta do ${repo}`, parsePort);
    command.addCommand(sub.action(async (branch, opts) => {
      await addRepoAction(branch, repo, opts);
    }));
  }
  return command;
}

export async function addRepoAction(
  branch: string,
  repo: AddableRepo,
  opts: { base?: string; port?: number } = {},
  deps: Partial<AddRepoDeps> = {},
): Promise<void> {
  const s = spinner(`Adicionando ${repo} em ${branch}...`).start();
  const result = await runAddRepo({ branch, repo, base: opts.base, port: opts.port }, createTerminalContext(s), deps)
    .catch(stopSpinnerOnError(s));

  const label = repoLabel(repo);
  s.succeed(`${label} adicionado em '${branch}'`);
  emptyLine();
  section("Paths");
  detail(label, result.path);
  if (result.port !== undefined) {
    section("Portas");
    detail(label, `localhost:${result.port}`);
  }
  section("Próximos passos");
  detail("1", result.port !== undefined ? `ns prepare ${branch}` : `ns doctor ${branch}`);
  detail("2", `ns open ${branch}`);
}

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0) throw new InvalidArgumentError(`Porta inválida: ${value}`);
  return port;
}
