import { MASTER_DB_PORT, MASTER_BACKEND_PORT, MASTER_FRONTEND_PORT, MASTER_MANAGER_PORT } from "./config";
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

export function getNextPort(base: number): number {
  let port = base;
  while (!isPortAvailable(port)) {
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
  const db = getNextPort(MASTER_DB_PORT);
  const backend = getNextPort(MASTER_BACKEND_PORT);
  const backendDebug = getNextPort(BACKEND_DEBUG_PORT_BASE);
  const frontend = getNextPort(MASTER_FRONTEND_PORT);
  
  const result: AllocatedPorts = { db, backend, backendDebug, frontend };
  
  if (includeManager) {
    result.manager = getNextPort(MASTER_MANAGER_PORT);
  }
  
  return result;
}
