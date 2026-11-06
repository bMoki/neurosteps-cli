import { select } from "@inquirer/prompts";
import { Command } from "commander";
import { relative, sep } from "path";
import { DEFAULT_BRANCH_ALIAS, type PullRepoResult, runPull } from "../core";
import { WORKTREES_DIR, branchExists, listBranches } from "../lib/config";
import { pathExists } from "../lib/filesystem";
import { colors, emptyLine, section, spinner } from "../lib/logger";
import { assertInteractiveInput } from "../lib/prompt";
import { exec } from "../lib/shell";
import { createTerminalContext, stopSpinnerOnError } from "../lib/terminal-context";

export function pullCommand(): Command {
  return new Command("pull")
    .description("Roda git pull em todos os repos da branch (@default = branch principal de cada repo)")
    .argument("[remote]", "remoto do git", "origin")
    .argument("[branch]", "branch a puxar (@default resolve main/master por repo)", "@default")
    .option("-b, --branch <worktree>", "branch de workspace (padrão: inferida do diretório atual)")
    .action((remote: string, branch: string, opts: { branch?: string }) => pullAction(remote, branch, opts));
}

export interface PullActionDeps {
  exec: typeof exec;
  cwd: () => string;
  listBranches: typeof listBranches;
  branchExists: typeof branchExists;
  pathExists: typeof pathExists;
  promptBranch: (branches: string[]) => Promise<string>;
}

const defaultDeps: PullActionDeps = {
  exec,
  cwd: () => process.cwd(),
  listBranches,
  branchExists,
  pathExists,
  promptBranch: async (branches) => {
    assertInteractiveInput("escolher a branch");
    return select({
      message: "Em qual branch rodar o pull?",
      choices: branches.map((b) => ({ name: b, value: b })),
    });
  },
};

export async function pullAction(
  remote: string | undefined,
  branch: string | undefined,
  opts: { branch?: string },
  deps: Partial<PullActionDeps> = {},
): Promise<void> {
  const d = { ...defaultDeps, ...deps };
  const targetRemote = remote ?? "origin";
  const targetBranch = branch ?? DEFAULT_BRANCH_ALIAS;

  const worktree = await resolveWorktree(opts.branch, d);
  const s = spinner(`Atualizando ${worktree}...`).start();
  const { repos: results } = await runPull(
    { branch: worktree, remote: targetRemote, target: targetBranch },
    createTerminalContext(s),
    d,
  ).catch(stopSpinnerOnError(s));
  s.stop();

  printSummary(worktree, results);

  if (results.every((r) => r.status === "skipped")) {
    throw new Error(`Branch '${targetBranch}' não existe em ${targetRemote} em nenhum repo`);
  }
  if (results.some((r) => r.status === "failed" || r.status === "conflict")) {
    process.exitCode = 1;
  }
}

async function resolveWorktree(explicit: string | undefined, d: PullActionDeps): Promise<string> {
  if (explicit) {
    if (!d.branchExists(explicit)) throw new Error(`Branch '${explicit}' não encontrada`);
    return explicit;
  }

  const inferred = inferWorktreeFromCwd(d.cwd());
  if (inferred && d.branchExists(inferred)) return inferred;

  const branches = d.listBranches();
  if (branches.length === 0) throw new Error("Nenhuma branch de workspace encontrada");
  return d.promptBranch(branches);
}

export function inferWorktreeFromCwd(cwd: string): string | null {
  const rel = relative(WORKTREES_DIR, cwd);
  if (!rel || rel.startsWith("..") || rel.startsWith(sep)) return null;
  return rel.split(sep)[0] || null;
}

function printSummary(worktree: string, results: PullRepoResult[]): void {
  section(`Pull em ${worktree}`);
  for (const r of results) {
    const label = r.branch ? `${r.repo} ${colors.muted(`(${r.branch})`)}` : r.repo;
    switch (r.status) {
      case "updated":
        console.error(`  ${colors.ok("✓")} ${label} ${colors.ok("atualizado")}`);
        break;
      case "up-to-date":
        console.error(`  ${colors.muted("=")} ${label} ${colors.muted("já atualizado")}`);
        break;
      case "skipped":
        console.error(`  ${colors.warn("⚠")} ${label} ${colors.warn(`ignorado: ${r.message}`)}`);
        break;
      case "conflict":
        console.error(`  ${colors.err("✗")} ${label} ${colors.err("conflito")} ${colors.muted(r.path)}`);
        for (const line of (r.message ?? "").split("\n")) {
          console.error(`      ${colors.muted(line)}`);
        }
        break;
      case "failed":
        console.error(`  ${colors.err("✗")} ${label} ${colors.err("falhou")} ${colors.muted(r.path)}`);
        for (const line of (r.message ?? "").split("\n")) {
          console.error(`      ${colors.muted(line)}`);
        }
        break;
    }
  }
  emptyLine();
}
