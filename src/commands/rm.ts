import { Command } from "commander";
import { type RmDeps, createSilentContext, runRm, runRmPreview, uncommittedError } from "../core";
import { listBranches, resolveBranchStateDir } from "../lib/config";
import { listFlaggedBranches, STALE_BRANCH_FLAG } from "../lib/branch-flags";
import { colors, hint, spinner, warn } from "../lib/logger";
import { confirm as defaultConfirm } from "../lib/prompt";
import { createTerminalContext, stopSpinnerOnError } from "../lib/terminal-context";

export function rmCommand(): Command {
  return new Command("rm")
    .description("Remove a worktree da branch")
    .argument("[branch]", "nome da branch")
    .option("--flagged <flag>", "remove apenas branches com a flag informada (ex: stale)")
    .option("--purge", "também remove o volume Docker")
    .option("-f, --force", "pula confirmação e força remoção de worktrees com alterações locais")
    .option("-n, --dry-run", "simula a operação sem executar")
    .action(async (branch, opts) => {
      const rmOpts = { purge: opts.purge || false, force: opts.force || false, dryRun: opts.dryRun || false };
      if (opts.flagged) {
        if (branch) throw new Error("Use uma branch ou --flagged, não ambos.");
        await rmFlaggedAction(opts.flagged, rmOpts);
        return;
      }

      if (!branch) throw new Error("Informe uma branch ou use --flagged <flag>.");
      await rmAction(branch, rmOpts);
    });
}

type RmOptions = { purge?: boolean; force?: boolean; dryRun?: boolean };

export interface RmActionDeps extends RmDeps {
  confirm: typeof defaultConfirm;
}

export async function rmAction(
  branch: string,
  { purge = false, force = false, dryRun = false }: RmOptions = {},
  deps: Partial<RmActionDeps> = {},
): Promise<void> {
  const { confirm = defaultConfirm, ...rmDeps } = deps;

  if (dryRun || !force) {
    const preview = await runRmPreview({ branch }, createSilentContext(), rmDeps);
    if (dryRun) {
      warn(`[dry-run] Seria removido:`);
      hint(`  worktree: ${preview.path}`);
      hint(`  logs dos serviços: ${resolveBranchStateDir(branch)}`);
      hint(`  branch local em: ${preview.repos.join(", ")}`);
      if (purge) {
        hint(`  volume Docker: ${preview.volume}`);
        hint(`  snapshots da branch ${branch} (volumes + pasta)`);
      }
      if (preview.uncommitted.length > 0) {
        warn(`Alterações não commitadas em ${preview.uncommitted.map(({ repo }) => repo).join(", ")}: só com --force`);
      }
      return;
    }
    if (preview.uncommitted.length > 0) {
      throw uncommittedError(branch, preview.uncommitted, "Faça commit ou descarte e tente de novo, ou use --force para remover mesmo assim.");
    }
    if (!(await confirm(`Remover branch ${branch}?`))) {
      warn("Operação cancelada.");
      return;
    }
  }

  const s = spinner(`Removendo ${branch}...`).start();
  await runRm({ branch, purge, force }, createTerminalContext(s), rmDeps).catch(stopSpinnerOnError(s));
  s.succeed(`${colors.bold(branch)} removida`);
}

interface RmFlaggedDeps {
  list: typeof listBranches;
  listFlagged: typeof listFlaggedBranches;
  rm: typeof rmAction;
}

const defaultFlaggedDeps: RmFlaggedDeps = {
  list: listBranches,
  listFlagged: listFlaggedBranches,
  rm: rmAction,
};

export async function rmFlaggedAction(
  flag: string,
  opts: RmOptions = {},
  deps: Partial<RmFlaggedDeps> = {},
): Promise<void> {
  if (flag !== STALE_BRANCH_FLAG) {
    throw new Error(`Flag '${flag}' não suportada. Flags disponíveis: ${STALE_BRANCH_FLAG}`);
  }

  const { list, listFlagged, rm } = { ...defaultFlaggedDeps, ...deps };
  const branches = await listFlagged(list(), flag);
  if (branches.length === 0) {
    warn(`Nenhuma branch com flag '${flag}' encontrada.`);
    return;
  }

  for (const branch of branches) {
    await rm(branch, opts);
  }
}
