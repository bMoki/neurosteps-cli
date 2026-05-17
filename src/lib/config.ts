import { join } from "path";
import {
  WORKTREES_DIR,
  BACKEND_REPO,
  FRONTEND_REPO,
  MANAGER_REPO,
  workspaceEnvSchema,
  type WorkspaceEnv,
} from "./env";
import { pathExists } from "./filesystem";

// Re-export env constants for backwards compatibility
export {
  BASE_DIR,
  WORKSPACE_DIR,
  TEMPLATES_DIR,
  WORKTREES_DIR,
  SNAPSHOTS_DIR,
  MASTER_DB_PORT,
  MASTER_BACKEND_PORT,
  MASTER_FRONTEND_PORT,
  MASTER_MANAGER_PORT,
  PORTLESS_PROXY_PORT,
  DB_USER,
  DB_PASSWORD,
  DB_NAME,
  SEED_VOLUME,
  PRODUCT_NAME,
  BACKEND_MODULE,
  BACKEND_REPO,
  FRONTEND_REPO,
  MANAGER_REPO,
} from "./env";

export type { WorkspaceEnv };

export async function readWorkspaceEnv(branch: string): Promise<WorkspaceEnv | null> {
  const envPath = join(WORKTREES_DIR, branch, ".workspace.env");
  try {
    const content = await Bun.file(envPath).text();
    const parse = (key: string) => {
      const match = content.match(new RegExp(`^${key}="(.+)"`, "m"));
      return match?.[1] ?? "";
    };

    const raw = {
      BRANCH_NAME: parse("BRANCH_NAME"),
      BRANCH_SLUG: parse("BRANCH_SLUG"),
      DB_PORT: parse("DB_PORT"),
      BACKEND_PORT: parse("BACKEND_PORT"),
      BACKEND_DEBUG_PORT: parse("BACKEND_DEBUG_PORT") || undefined,
      FRONTEND_PORT: parse("FRONTEND_PORT"),
      MANAGER_PORT: parse("MANAGER_PORT") || undefined,
      DB_VOLUME: parse("DB_VOLUME"),
      DB_CONTAINER: parse("DB_CONTAINER"),
      COMPOSE_PROJECT: parse("COMPOSE_PROJECT"),
    };

    return workspaceEnvSchema.parse(raw);
  } catch {
    return null;
  }
}

export function resolveBackendDir(branch: string): string {
  const wt = join(WORKTREES_DIR, branch, "backend");
  return pathExists(wt) ? wt : BACKEND_REPO;
}

export function resolveFrontendDir(branch: string): string {
  const wt = join(WORKTREES_DIR, branch, "frontend");
  return pathExists(wt) ? wt : FRONTEND_REPO;
}

export function resolveManagerDir(branch: string): string {
  const wt = join(WORKTREES_DIR, branch, "manager");
  return pathExists(wt) ? wt : MANAGER_REPO;
}

export function hasManager(branch: string): boolean {
  try {
    return pathExists(join(WORKTREES_DIR, branch, "manager"));
  } catch {
    return false;
  }
}

export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function listBranches(): string[] {
  try {
    const result = Bun.spawnSync(["ls", "-1", WORKTREES_DIR], {
      stdout: "pipe",
    });
    const stdout = new TextDecoder().decode(result.stdout);
    return stdout
      .split("\n")
      .map((d) => d.trim())
      .filter((d) => d.length > 0 && !d.startsWith("."));
  } catch {
    return [];
  }
}

export function branchExists(branch: string): boolean {
  try {
    return pathExists(join(WORKTREES_DIR, branch, ".workspace.env"));
  } catch {
    return false;
  }
}
