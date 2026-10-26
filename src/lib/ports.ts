import { readFileSync } from "fs";
import { join } from "path";
import { MASTER_DB_PORT, MASTER_BACKEND_PORT, MASTER_FRONTEND_PORT, MASTER_MANAGER_PORT, WORKTREES_DIR, listBranches } from "./config";
import { commandErrorMessage, execSync, type ShellResult } from "./shell";

const BACKEND_DEBUG_PORT_BASE = 5005;
// 9000 é a porta de management do master (application.properties); worktrees começam em 9001.
const MANAGEMENT_PORT_BASE = 9001;
const PORT_KEYS = ["DB_PORT", "BACKEND_PORT", "BACKEND_DEBUG_PORT", "MANAGEMENT_PORT", "FRONTEND_PORT", "MANAGER_PORT", "REPORT_SERVER_PORT"];

export function isPortAvailable(port: number): boolean {
  let result: ShellResult;
  try {
    result = execSync(["lsof", "-Pi", `:${port}`, "-sTCP:LISTEN"], { silent: true });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Falha ao verificar porta ${port} com lsof: ${reason}`);
  }
  if (result.exitCode === 0) return false;
  if (!result.stderr.trim()) return true;
  throw new Error(commandErrorMessage(`verificar porta ${port} com lsof`, result));
}

export function getAssignedPorts(): Set<number> {
  const reserved = new Set<number>();
  for (const branch of listBranches()) {
    try {
      const content = readFileSync(join(WORKTREES_DIR, branch, ".workspace.env"), "utf8");
      for (const key of PORT_KEYS) {
        const match = content.match(new RegExp(`^${key}="(\\d+)"`, "m"));
        if (match) reserved.add(Number(match[1]));
      }
    } catch {
      // ignora branches ilegíveis
    }
  }
  return reserved;
}

export function getNextPort(base: number, reserved: Set<number> = new Set()): number {
  let port = base;
  while (!isPortAvailable(port) || reserved.has(port)) {
    port++;
  }
  return port;
}

export interface AllocatedPorts {
  db: number;
  backend: number;
  backendDebug: number;
  management: number;
  frontend: number;
  manager?: number;
}

export function allocatePorts(includeManager = false): AllocatedPorts {
  const reserved = getAssignedPorts();

  const db = getNextPort(MASTER_DB_PORT, reserved);
  reserved.add(db);
  const backend = getNextPort(MASTER_BACKEND_PORT, reserved);
  reserved.add(backend);
  const backendDebug = getNextPort(BACKEND_DEBUG_PORT_BASE, reserved);
  reserved.add(backendDebug);
  const management = getNextPort(MANAGEMENT_PORT_BASE, reserved);
  reserved.add(management);
  const frontend = getNextPort(MASTER_FRONTEND_PORT, reserved);
  reserved.add(frontend);

  const result: AllocatedPorts = { db, backend, backendDebug, management, frontend };

  if (includeManager) {
    result.manager = getNextPort(MASTER_MANAGER_PORT, reserved);
  }

  return result;
}

export function allocateManagementPort(): number {
  return getNextPort(MANAGEMENT_PORT_BASE, getAssignedPorts());
}

/**
 * Garante que a worktree tenha MANAGEMENT_PORT no .workspace.env.
 * Worktrees criadas antes desse campo recebem uma porta nova, persistida no arquivo.
 */
export async function ensureManagementPort(branch: string, current?: number): Promise<number> {
  if (current) return current;

  const port = allocateManagementPort();
  const envPath = join(WORKTREES_DIR, branch, ".workspace.env");
  const content = await Bun.file(envPath).text();
  const line = `MANAGEMENT_PORT="${port}"`;
  let updated: string;
  if (/^MANAGEMENT_PORT=.*/m.test(content)) {
    updated = content.replace(/^MANAGEMENT_PORT=.*/m, line);
  } else if (/^BACKEND_DEBUG_PORT=.*/m.test(content)) {
    updated = content.replace(/^(BACKEND_DEBUG_PORT=.*)$/m, `$1\n${line}`);
  } else {
    updated = `${content.replace(/\n?$/, "\n")}${line}\n`;
  }
  await Bun.write(envPath, updated);
  return port;
}
