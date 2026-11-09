import { join } from "path";
import {
  WORKTREES_DIR,
  hasManager as defaultHasManager,
  hasReportServer as defaultHasReportServer,
} from "../../lib/config";
import { installedMatchesLockfile as defaultInstalledMatchesLockfile } from "../../lib/deps";
import { pathExists } from "../../lib/filesystem";
import { type ShellResult, commandErrorMessage, exec } from "../../lib/shell";
import type { NsContext } from "../context";
import { ferramentaExterna, naoEncontrado } from "../errors";
import { type DepsSpec, type ServiceId, depsSpecs, installFresh, reusedMarker, updateCommand } from "./prepare";

/** Repos que têm dependências instaladas pelo `ns`. */
export const DEPS_REPOS = ["frontend", "manager", "report-server"] as const satisfies readonly ServiceId[];
export type DepsRepo = (typeof DEPS_REPOS)[number];

/**
 * instaladas: iguais ao que a branch declara. da-master: reaproveitadas e iguais.
 * da-master-divergentes: reaproveitadas e diferentes. faltando: sem instalação.
 */
export type DepsState = "instaladas" | "da-master" | "da-master-divergentes" | "faltando";

/** Os estados que pedem Instalar: divergentes da master ou sem instalação. */
export function needsInstall(state: DepsState): boolean {
  return state === "da-master-divergentes" || state === "faltando";
}

export interface RepoDeps {
  id: ServiceId;
  cwd: string;
  state: DepsState;
  command: string;                      // o que rodar à mão, ex.: "npm install"
}

export interface DepsStatusInput {
  branch: string;
}

export interface DepsStatusResult {
  branch: string;
  repos: RepoDeps[];
}

export interface InstallDepsInput {
  branch: string;
  repo: DepsRepo;
}

export interface DepsOperationDeps {
  run: typeof exec;
  exists: (path: string) => boolean;
  hasManager: typeof defaultHasManager;
  hasReportServer: typeof defaultHasReportServer;
  installedMatchesLockfile: typeof defaultInstalledMatchesLockfile;
}

const defaultDeps: DepsOperationDeps = {
  run: exec,
  exists: pathExists,
  hasManager: defaultHasManager,
  hasReportServer: defaultHasReportServer,
  installedMatchesLockfile: defaultInstalledMatchesLockfile,
};

// Saída de instalação que falha é longa; o fim dela é o que explica o erro.
const ERROR_TAIL_LINES = 15;

/**
 * O estado das dependências de cada Repo da branch que tem dependências. Só as que
 * vieram da master são comparadas com o que a branch declara; uma instalação da
 * própria branch conta como instalada, como em Preparar.
 */
export async function runDepsStatus(
  input: DepsStatusInput,
  _ctx: NsContext,
  overrides: Partial<DepsOperationDeps> = {},
): Promise<DepsStatusResult> {
  const deps = { ...defaultDeps, ...overrides };
  return { branch: input.branch, repos: specsOf(input.branch, deps).map((spec) => describe(spec, deps)) };
}

/**
 * Instala as dependências de um Repo da branch. Sobre uma instalação existente, como a
 * que veio da master, roda o `install` do gerenciador, que só instala as diferenças;
 * sem instalação, instala do zero como Preparar. Instaladas, deixam de ser da master.
 */
export async function runInstallDeps(
  input: InstallDepsInput,
  ctx: NsContext,
  overrides: Partial<DepsOperationDeps> = {},
): Promise<RepoDeps> {
  const deps = { ...defaultDeps, ...overrides };
  const spec = specsOf(input.branch, deps).find(({ id }) => id === input.repo);
  if (!spec) throw naoEncontrado(`A branch '${input.branch}' não tem dependências do ${input.repo}`);

  ctx.emit({ step: `deps:install:${spec.id}`, label: `Instalando dependências do ${spec.id}...` });
  const failed = await install(spec, deps.exists(spec.marker), deps.run).catch((error: unknown) => {
    throw ferramentaExterna(error instanceof Error ? error.message : String(error), { cause: error });
  });
  if (failed) {
    throw ferramentaExterna(lastLines(commandErrorMessage(`instalar as dependências do ${spec.id}`, failed)), {
      hint: `Rode manualmente: ${commandOf(spec)} em ${spec.cwd}`,
    });
  }
  await deps.run(["rm", "-f", reusedMarker(spec.cwd)], { silent: true });
  ctx.emit({ step: `deps:install:${spec.id}:done`, label: `Dependências do ${spec.id} instaladas` });
  return describe(spec, deps);
}

function specsOf(branch: string, deps: DepsOperationDeps): DepsSpec[] {
  if (!deps.exists(join(WORKTREES_DIR, branch, ".workspace.env"))) {
    throw naoEncontrado(`Worktree '${branch}' não encontrada`, "Veja as branches com: ns status");
  }
  return depsSpecs(branch, deps.hasManager(branch), deps.hasReportServer(branch));
}

function describe(spec: DepsSpec, deps: DepsOperationDeps): RepoDeps {
  return { id: spec.id, cwd: spec.cwd, state: stateOf(spec, deps), command: commandOf(spec) };
}

function stateOf(spec: DepsSpec, deps: DepsOperationDeps): DepsState {
  if (!deps.exists(spec.marker)) return "faltando";
  if (!deps.exists(reusedMarker(spec.cwd))) return "instaladas";
  return deps.installedMatchesLockfile(spec.cwd, spec.packageManager) ? "da-master" : "da-master-divergentes";
}

function commandOf(spec: DepsSpec): string {
  return updateCommand(spec).join(" ");
}

/** Devolve o resultado do comando que falhou, ou nada se instalou. */
async function install(spec: DepsSpec, installed: boolean, run: typeof exec): Promise<ShellResult | undefined> {
  if (!installed) return installFresh(spec, run);
  const result = await run(updateCommand(spec), { cwd: spec.cwd, silent: true });
  return result.exitCode === 0 ? undefined : result;
}

function lastLines(text: string): string {
  const lines = text.split("\n");
  if (lines.length <= ERROR_TAIL_LINES + 1) return text;
  return [lines[0], "…", ...lines.slice(-ERROR_TAIL_LINES)].join("\n");
}
