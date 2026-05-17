import { readWorkspaceEnv, WORKTREES_DIR, SEED_VOLUME } from "../lib/config";
import { dockerComposeDown, dockerVolumeRm, dockerVolumeCreate, dockerVolumeCopy } from "../lib/docker";
import { confirm } from "../lib/prompt";
import { error, spinner, warn } from "../lib/logger";
import { join } from "path";

export async function clearDbAction(branch: string): Promise<void> {
  const env = await readWorkspaceEnv(branch);
  if (!env) {
    error(`Branch '${branch}' não encontrada`);
    process.exit(1);
  }

  const shouldClear = await confirm(
    `Isso vai APAGAR o volume de banco da branch '${branch}' e reseedar a partir do original.`,
  );
  if (!shouldClear) {
    warn("Operação cancelada.");
    return;
  }

  const s = spinner("Resetando banco...").start();
  const wtDir = join(WORKTREES_DIR, branch);
  const composeFile = join(wtDir, "docker-compose.yml");

  s.text = "Parando serviços...";
  await dockerComposeDown(composeFile, env.COMPOSE_PROJECT);

  s.text = "Removendo volume Docker...";
  await dockerVolumeRm(env.DB_VOLUME);

  s.text = "Seedando a partir do volume original...";
  await dockerVolumeCreate(env.DB_VOLUME);
  await dockerVolumeCopy(SEED_VOLUME, env.DB_VOLUME);

  s.text = "Iniciando PostgreSQL limpo...";
  const { dockerComposeUp, waitForPostgres } = await import("../lib/docker");
  await dockerComposeUp(composeFile, env.COMPOSE_PROJECT);
  await waitForPostgres(env.DB_CONTAINER, { user: env.DB_USER, database: env.DB_NAME });

  s.succeed(`Banco de ${branch} resetado e reseedado`);
}
