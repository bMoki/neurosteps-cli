import { commandErrorMessage, execChecked, execSync, type ShellResult } from "./shell";
import { PORTLESS_PROXY_PORT } from "./config";

export async function registerAlias(
  name: string,
  port: number,
): Promise<void> {
  await execChecked(
    ["portless", "alias", name, String(port)],
    { silent: true },
    `registrar alias Portless ${name}`,
  );
}

export async function removeAlias(name: string): Promise<void> {
  await execChecked(
    ["portless", "alias", "--remove", name],
    { silent: true },
    `remover alias Portless ${name}`,
  );
}

export async function listAliases(): Promise<string[]> {
  const result = await execChecked(
    ["portless", "list"],
    { silent: true },
    "listar aliases Portless",
  );
  return result.stdout.split("\n").filter((l) => l.trim().length > 0);
}

export function isProxyRunning(): boolean {
  let result: ShellResult;
  try {
    result = execSync(
      ["lsof", "-Pi", `:${PORTLESS_PROXY_PORT}`, "-sTCP:LISTEN"],
      { silent: true },
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Falha ao verificar porta ${PORTLESS_PROXY_PORT} com lsof: ${reason}`);
  }
  if (result.exitCode === 0) return true;
  if (!result.stderr.trim()) return false;
  throw new Error(commandErrorMessage(`verificar porta ${PORTLESS_PROXY_PORT} com lsof`, result));
}

export async function startProxy(): Promise<void> {
  await execChecked(
    ["portless", "proxy", "start", "-p", String(PORTLESS_PROXY_PORT)],
    { silent: true },
    `iniciar proxy Portless na porta ${PORTLESS_PROXY_PORT}`,
  );
}
