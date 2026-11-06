import { Argument, Command, InvalidArgumentError } from "commander";
import { detail, emptyLine, hint, section, spinner, warn } from "../lib/logger";
import { createTerminalContext, stopSpinnerOnError } from "../lib/terminal-context";
import { type NewDeps, OPTIONAL_REPOS, type OptionalRepo, repoLabel, runNew } from "../core";
import { warnMissingDeps } from "./prepare";

export function newCommand(deps: Partial<NewDeps> = {}): Command {
  return new Command("new")
    .description("Cria e prepara uma branch com worktrees configuradas (inclui manager por padrão)")
    .argument("<branch>", "nome da branch")
    .addArgument(new Argument("[base-branch]", "branch base").default("master"))
    .option("--no-manager", "não inclui o repo manager")
    .option("--with <repos>", "inclui Repos opcionais separados por vírgula (report-server,parents), cada um na sua base padrão", parseRepos)
    .action(async (branch, baseBranch, opts) => {
      const repos: OptionalRepo[] = [...(opts.manager === false ? [] : ["manager" as const]), ...(opts.with ?? [])];
      await newAction(branch, baseBranch, repos, deps);
    });
}

export async function newAction(
  branch: string,
  baseBranch: string,
  repos: OptionalRepo[],
  deps: Partial<NewDeps> = {},
): Promise<void> {
  const s = spinner(`Criando worktree da branch ${branch}...`).start();
  const result = await runNew({ branch, baseBranch, repos, installMissingDeps: "always" }, createTerminalContext(s), deps)
    .catch(stopSpinnerOnError(s));

  if (result.missingRepos.length > 0) {
    s.warn(`Worktree '${branch}' criada e preparada, sem ${result.missingRepos.map(({ repo }) => repo).join(", ")}`);
  } else {
    s.succeed(`Worktree '${branch}' criada e preparada`);
  }
  warnMissingDeps(result.prepared);

  emptyLine();
  section("Paths");
  detail("Backend", result.paths.backend);
  detail("Frontend", result.paths.frontend);
  detail("Docs", result.paths.docs);
  if (result.paths.manager) detail("Manager", result.paths.manager);
  if (result.paths.reportServer) detail("Report-server", result.paths.reportServer);
  if (result.paths.parents) detail("Parents", result.paths.parents);
  section("Portas");
  detail("Database", `localhost:${result.ports.db}`);
  detail("Backend", `localhost:${result.ports.backend}`);
  detail("Management", `localhost:${result.ports.management}`);
  detail("Frontend", `localhost:${result.ports.frontend}`);
  if (result.ports.manager) detail("Manager", `localhost:${result.ports.manager}`);
  if (result.ports.reportServer) detail("Report-server", `localhost:${result.ports.reportServer}`);
  section("URLs");
  detail("Frontend", result.urls.frontend);
  detail("Backend", result.urls.backend);
  detail("Swagger", result.urls.swagger);
  if (result.urls.manager) detail("Manager", result.urls.manager);
  if (result.urls.reportServer) detail("Report-server", result.urls.reportServer);
  if (result.missingRepos.length > 0) {
    section("Repos que faltaram");
    for (const missing of result.missingRepos) {
      warn(`${repoLabel(missing.repo)}: ${missing.message}`);
      hint(`  Para tentar de novo: ns add ${missing.repo} ${branch}`);
    }
  }
  section("Próximos passos");
  hint(`  1. ns open ${branch}       # abrir no IDE`);
  hint(`  2. ns start ${branch}      # subir os Serviços`);
}

const WITH_REPOS = OPTIONAL_REPOS.filter((repo) => repo !== "manager");

function parseRepos(value: string): OptionalRepo[] {
  const repos = value.split(",").map((repo) => repo.trim()).filter(Boolean);
  const unknown = repos.filter((repo) => !(WITH_REPOS as readonly string[]).includes(repo));
  if (unknown.length > 0) {
    throw new InvalidArgumentError(`Repo opcional desconhecido: ${unknown.join(", ")}. Use: ${WITH_REPOS.join(", ")}.`);
  }
  return repos as OptionalRepo[];
}
