import { WORKTREES_DIR, readWorkspaceEnv, hasManager, PRODUCT_NAME, BACKEND_REPO, FRONTEND_REPO, MANAGER_REPO } from "../lib/config";
import { dockerComposeDown, dockerVolumeRm } from "../lib/docker";
import { removeWorktree, deleteBranch } from "../lib/git";
import { removeAlias } from "../lib/portless";
import { confirm as defaultConfirm } from "../lib/prompt";
import { colors, hint, spinner, warn } from "../lib/logger";
import { join } from "path";

interface RmDeps {
  readEnv: typeof readWorkspaceEnv;
  composeDown: typeof dockerComposeDown;
  volumeRm: typeof dockerVolumeRm;
  rmAlias: typeof removeAlias;
  rmWorktree: typeof removeWorktree;
  delBranch: typeof deleteBranch;
  hasMgr: typeof hasManager;
  confirm: typeof defaultConfirm;
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
};

export async function rmAction(
  branch: string,
  { purge = false, force = false, dryRun = false }: { purge?: boolean; force?: boolean; dryRun?: boolean } = {},
  deps: Partial<RmDeps> = {},
): Promise<void> {
  const { readEnv, composeDown, volumeRm, rmAlias, rmWorktree, delBranch, hasMgr, confirm } = {
    ...defaultDeps,
    ...deps,
  };

  const env = await readEnv(branch);
  if (!env) {
    warn(`Branch '${branch}' não encontrada`);
    process.exit(1);
  }

  if (dryRun) {
    const wtDir = join(WORKTREES_DIR, branch);
    warn(`[dry-run] Seria removido:`);
    hint(`  worktree: ${wtDir}`);
    hint(`  branch local em: ${BACKEND_REPO}, ${FRONTEND_REPO}`);
    if (hasMgr(branch)) hint(`  branch local em: ${MANAGER_REPO}`);
    if (purge) hint(`  volume Docker: ${env.DB_VOLUME}`);
    return;
  }

  const s = spinner(`Removendo ${branch}...`).start();

  if (!force) {
    s.stop();
    const shouldDelete = await confirm(`Remover branch ${branch}?`);
    if (!shouldDelete) {
      warn("Operação cancelada.");
      return;
    }
    s.start();
  }

  const wtDir = join(WORKTREES_DIR, branch);
  const composeFile = join(wtDir, "docker-compose.yml");

  const aliasSlug = env.BRANCH_SLUG || branch.toLowerCase();

  s.text = "Parando serviços...";
  await composeDown(composeFile, env.COMPOSE_PROJECT);

  s.text = "Removendo aliases Portless...";
  await rmAlias(`${aliasSlug}.web.${PRODUCT_NAME}`);
  await rmAlias(`${aliasSlug}.api.${PRODUCT_NAME}`);
  if (env.MANAGER_PORT) {
    await rmAlias(`${aliasSlug}.manager.${PRODUCT_NAME}`);
  }

  if (purge) {
    s.text = "Removendo volume Docker...";
    await volumeRm(env.DB_VOLUME);
  }

  s.text = "Removendo worktrees...";
  await rmWorktree(BACKEND_REPO, join(wtDir, "backend"));
  await rmWorktree(FRONTEND_REPO, join(wtDir, "frontend"));
  if (hasMgr(branch)) {
    await rmWorktree(MANAGER_REPO, join(wtDir, "manager"));
  }

  s.text = "Removendo branches locais...";
  await delBranch(BACKEND_REPO, branch);
  await delBranch(FRONTEND_REPO, branch);
  if (hasMgr(branch)) {
    await delBranch(MANAGER_REPO, branch);
  }

  s.succeed(`${colors.bold(branch)} removida`);
}
