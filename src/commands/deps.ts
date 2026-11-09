import { Command, InvalidArgumentError } from "commander";
import { detail, emptyLine, hint, section, spinner, warn } from "../lib/logger";
import { createTerminalContext, stopSpinnerOnError } from "../lib/terminal-context";
import {
  DEPS_REPOS,
  type DepsOperationDeps,
  type DepsRepo,
  type DepsState,
  createSilentContext,
  needsInstall,
  runDepsStatus,
  runInstallDeps,
} from "../core";

const STATE_LABELS: Record<DepsState, string> = {
  instaladas: "Instaladas",
  "da-master": "Da master",
  "da-master-divergentes": "Da master, divergentes",
  faltando: "Faltando",
};

export function depsCommand(): Command {
  return new Command("deps")
    .description("Mostra o estado das dependências de cada repo da branch, ou instala as de um repo")
    .argument("<branch>", "nome da branch")
    .option("-i, --install <repo>", `instala as dependências de um repo (${DEPS_REPOS.join(", ")})`, parseRepo)
    .action(async (branch: string, opts: { install?: DepsRepo }) => {
      if (opts.install) await installDepsAction(branch, opts.install);
      else await depsAction(branch);
    });
}

export async function depsAction(branch: string, deps: Partial<DepsOperationDeps> = {}): Promise<void> {
  const { repos } = await runDepsStatus({ branch }, createSilentContext(), deps);
  section(`Dependências de ${branch}`);
  for (const repo of repos) detail(repo.id, STATE_LABELS[repo.state]);
  const pending = repos.filter(({ state }) => needsInstall(state));
  if (pending.length === 0) return;
  emptyLine();
  for (const repo of pending) {
    warn(repo.state === "faltando"
      ? `${repo.id}: sem dependências instaladas`
      : `${repo.id}: as dependências são as da master e diferem das da branch; ela pode não funcionar`);
  }
  hint(`Instale com: ns deps ${branch} --install <repo>`);
}

export async function installDepsAction(branch: string, repo: DepsRepo, deps: Partial<DepsOperationDeps> = {}): Promise<void> {
  const s = spinner(`Instalando dependências do ${repo} em ${branch}...`).start();
  const result = await runInstallDeps({ branch, repo }, createTerminalContext(s), deps).catch(stopSpinnerOnError(s));
  s.succeed(`Dependências do ${repo} instaladas (${STATE_LABELS[result.state]})`);
}

function parseRepo(value: string): DepsRepo {
  if (!(DEPS_REPOS as readonly string[]).includes(value)) {
    throw new InvalidArgumentError(`Repo sem dependências: ${value} (use ${DEPS_REPOS.join(", ")})`);
  }
  return value as DepsRepo;
}
