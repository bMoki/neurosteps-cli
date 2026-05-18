import { exec, execChecked } from "./shell";
import { DB_USER, DB_NAME } from "./config";

export interface PostgresConnectionOptions {
  user?: string;
  database?: string;
}

export async function dockerComposeUp(
  composeFile: string,
  project: string,
): Promise<void> {
  await execChecked([
    "docker", "compose", "-f", composeFile, "-p", project, "up", "-d",
  ], { silent: true }, "subir docker compose");
}

export async function dockerComposeDown(
  composeFile: string,
  project: string,
): Promise<void> {
  await execChecked([
    "docker", "compose", "-f", composeFile, "-p", project, "down",
  ], { silent: true }, "parar docker compose");
}

export async function dockerVolumeCreate(name: string): Promise<void> {
  await execChecked(["docker", "volume", "create", name], { silent: true }, `criar volume Docker ${name}`);
}

export async function dockerVolumeRm(name: string): Promise<void> {
  await exec(["docker", "volume", "rm", name], { silent: true });
}

export async function dockerVolumeExists(name: string): Promise<boolean> {
  const result = await execChecked(
    ["docker", "volume", "ls", "-q"],
    { silent: true },
    "listar volumes Docker",
  );
  return result.stdout.split("\n").includes(name);
}

export async function dockerVolumeCopy(
  from: string,
  to: string,
): Promise<void> {
  await execChecked([
    "docker", "run", "--rm",
    "-v", `${from}:/from`,
    "-v", `${to}:/to`,
    "alpine:latest",
    "sh", "-c", "cp -a /from/. /to/",
  ], { silent: true }, `copiar volume Docker ${from} para ${to}`);
}

export async function dockerPs(containerName: string): Promise<boolean> {
  const result = await execChecked(
    ["docker", "ps", "--format", "{{.Names}}"],
    { silent: true },
    "listar containers Docker",
  );
  return result.stdout.split("\n").includes(containerName);
}

export async function dockerExec(
  container: string,
  command: string[],
): Promise<{ exitCode: number; stdout: string }> {
  const result = await exec(
    ["docker", "exec", container, ...command],
    { silent: true },
  );
  return { exitCode: result.exitCode, stdout: result.stdout };
}

export async function isPostgresReady(
  container: string,
  options: PostgresConnectionOptions = {},
): Promise<boolean> {
  const user = options.user ?? DB_USER;
  const database = options.database ?? DB_NAME;
  const { exitCode } = await dockerExec(container, [
    "pg_isready", "-U", user, "-d", database,
  ]);
  return exitCode === 0;
}

export async function waitForPostgres(
  container: string,
  retriesOrOptions: number | PostgresConnectionOptions = 30,
  options: PostgresConnectionOptions = {},
): Promise<void> {
  const retries = typeof retriesOrOptions === "number" ? retriesOrOptions : 30;
  const connectionOptions = typeof retriesOrOptions === "number" ? options : retriesOrOptions;

  for (let i = 0; i < retries; i++) {
    if (await isPostgresReady(container, connectionOptions)) {
      return;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("PostgreSQL failed to become ready");
}
