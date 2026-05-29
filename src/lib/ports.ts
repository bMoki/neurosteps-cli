import { readFileSync } from "fs";
import { join } from "path";
import { MASTER_DB_PORT, MASTER_BACKEND_PORT, MASTER_FRONTEND_PORT, MASTER_MANAGER_PORT, WORKTREES_DIR, listBranches } from "./config";
import { commandErrorMessage, execSync, type ShellResult } from "./shell";

const BACKEND_DEBUG_PORT_BASE = 5005;

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
      for (const key of ["DB_PORT", "BACKEND_PORT", "BACKEND_DEBUG_PORT", "FRONTEND_PORT", "MANAGER_PORT"]) {
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
  const frontend = getNextPort(MASTER_FRONTEND_PORT, reserved);
  reserved.add(frontend);

  const result: AllocatedPorts = { db, backend, backendDebug, frontend };

  if (includeManager) {
    result.manager = getNextPort(MASTER_MANAGER_PORT, reserved);
  }

  return result;
}
