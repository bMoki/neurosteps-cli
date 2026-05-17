import { readWorkspaceEnv, WORKTREES_DIR } from "../lib/config";
import { dockerComposeUp, waitForPostgres } from "../lib/docker";
import { spinner } from "../lib/logger";
import { join } from "path";

export async function dbOnlyAction(branch: string): Promise<void> {
  const s = spinner(`Iniciando PostgreSQL para ${branch}...`).start();

  const env = await readWorkspaceEnv(branch);
  if (!env) {
    s.fail(`Branch '${branch}' não encontrada`);
    process.exit(1);
  }

  const wtDir = join(WORKTREES_DIR, branch);
  const composeFile = join(wtDir, "docker-compose.yml");

  await dockerComposeUp(composeFile, env.COMPOSE_PROJECT);
  await waitForPostgres(env.DB_CONTAINER);

  s.succeed(`PostgreSQL pronto em localhost:${env.DB_PORT}`);
}
