import { exec, execChecked } from "./shell";
import { DB_USER, DB_NAME } from "./config";

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
  await execChecked(["docker", "volume", "rm", name], { silent: true }, `remover volume Docker ${name}`);
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
): Promise<boolean> {
  const { exitCode } = await dockerExec(container, [
    "pg_isready", "-U", DB_USER, "-d", DB_NAME,
  ]);
  return exitCode === 0;
}

export async function waitForPostgres(
  container: string,
  retries = 30,
): Promise<void> {
  for (let i = 0; i < retries; i++) {
    if (await isPostgresReady(container)) {
      return;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("PostgreSQL failed to become ready");
}
