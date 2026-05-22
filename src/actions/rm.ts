import { WORKTREES_DIR, readWorkspaceEnv, hasManager, PRODUCT_NAME, BACKEND_REPO, FRONTEND_REPO, MANAGER_REPO } from "../lib/config";
import { dockerComposeDown, dockerVolumeRm } from "../lib/docker";
import { removeWorktree, deleteBranch } from "../lib/git";
import { removeAlias } from "../lib/portless";
import { confirm as defaultConfirm } from "../lib/prompt";
import { colors, spinner, warn } from "../lib/logger";
import { join } from "path";
import { rm } from "fs/promises";

interface RmDeps {
  readEnv: typeof readWorkspaceEnv;
  composeDown: typeof dockerComposeDown;
  volumeRm: typeof dockerVolumeRm;
  rmAlias: typeof removeAlias;
  rmWorktree: typeof removeWorktree;
  delBranch: typeof deleteBranch;
  hasMgr: typeof hasManager;
  confirm: typeof defaultConfirm;
  rmDir: (path: string) => Promise<void>;
}

const defaultDeps: RmDeps = {
  readEnv: readWorkspaceEnv,
  composeDown: dockerComposeDown,
  volumeRm: dockerVolumeRm,
  rmAlias: removeAlias,
  rmWorktree: removeWorktree,
  delBranch: deleteBranch,
  hasMgr: hasManager,
  confirm: defaultConfirm,
  rmDir: (path) => rm(path, { recursive: true, force: true }),
};

export async function rmAction(
  branch: string,
  { purge = false, force = false, dryRun = false }: { purge?: boolean; force?: boolean; dryRun?: boolean } = {},
  deps: Partial<RmDeps> = {},
): Promise<void> {
  const { readEnv, composeDown, volumeRm, rmAlias, rmWorktree, delBranch, hasMgr, confirm, rmDir } = {
    ...defaultDeps,
    ...deps,
  };

  const env = await readEnv(branch);
  if (!env) {
    warn(`Branch '${branch}' não encontrada`);
    process.exit(1);
  }

  const wtDir = join(WORKTREES_DIR, branch);

  if (dryRun) {
    warn(`[dry-run] Seria removido:`);
    const { hint } = await import("../lib/logger");
    hint(`  worktree: ${wtDir}`);
    hint(`  branch local em: ${BACKEND_REPO}, ${FRONTEND_REPO}`);
    if (hasMgr(branch)) hint(`  branch local em: ${MANAGER_REPO}`);
    if (purge) hint(`  volume Docker: ${env.DB_VOLUME}`);
    return;
  }

  if (!force) {
    const shouldDelete = await confirm(`Remover branch ${branch}?`);
    if (!shouldDelete) {
      warn("Operação cancelada.");
      return;
    }
  }

  const composeFile = join(wtDir, "docker-compose.yml");
  const aliasSlug = env.BRANCH_SLUG || branch.toLowerCase();

  const step = async (msg: string, successMsg: string, fn: () => Promise<void>) => {
    const s = spinner(msg).start();
    try {
      await fn();
      s.succeed(successMsg);
    } catch (e) {
      s.fail(msg);
      throw e;
    }
  };

  await step("Parando serviços...", "Serviços parados", () =>
    composeDown(composeFile, env.COMPOSE_PROJECT),
  );

  await step("Removendo aliases Portless...", "Aliases Portless removidos", async () => {
    await rmAlias(`${aliasSlug}.web.${PRODUCT_NAME}`);
    await rmAlias(`${aliasSlug}.api.${PRODUCT_NAME}`);
    if (env.MANAGER_PORT) await rmAlias(`${aliasSlug}.manager.${PRODUCT_NAME}`);
  });

  if (purge) {
    await step("Removendo volume Docker...", "Volume Docker removido", () =>
      volumeRm(env.DB_VOLUME),
    );
  }

  await step("Removendo worktrees...", "Worktrees removidas", async () => {
    await rmWorktree(BACKEND_REPO, join(wtDir, "backend"), { force });
    await rmWorktree(FRONTEND_REPO, join(wtDir, "frontend"), { force });
    if (hasMgr(branch)) await rmWorktree(MANAGER_REPO, join(wtDir, "manager"), { force });
  });

  await step("Removendo branches locais...", "Branches locais removidas", async () => {
    await delBranch(BACKEND_REPO, branch);
    await delBranch(FRONTEND_REPO, branch);
    if (hasMgr(branch)) await delBranch(MANAGER_REPO, branch);
  });

  await step("Removendo diretório...", `${colors.bold(branch)} removida`, () =>
    rmDir(wtDir),
  );
}
