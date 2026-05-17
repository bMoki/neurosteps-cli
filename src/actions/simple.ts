import { readWorkspaceEnv } from "../lib/config";
import { error, info } from "../lib/logger";
import { execChecked } from "../lib/shell";

export async function logsAction(branch: string): Promise<void> {
  const env = await readWorkspaceEnv(branch);
  if (!env) {
    error(`Branch '${branch}' não encontrada`);
    process.exit(1);
  }

  info(`Logs do banco de ${branch}. Use Ctrl+C para sair.`);
  await execChecked(["docker", "logs", "-f", env.DB_CONTAINER], {}, `acompanhar logs do container ${env.DB_CONTAINER}`);
}

export async function dbPortAction(branch: string): Promise<void> {
  const env = await readWorkspaceEnv(branch);
  if (!env) {
    error(`Branch '${branch}' não encontrada`);
    process.exit(1);
  }
  console.log(env.DB_PORT);
}
