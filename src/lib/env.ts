import { z } from "zod";
import { homedir } from "os";
import { join } from "path";
import { existsSync, readFileSync } from "fs";

const envSchema = z.object({
  // ─── Paths do sistema (opcionais com defaults) ───
  NS_BASE_DIR: z.string().default(join(homedir(), "Developer")),
  NS_BACKEND_REPO: z.string().optional(),
  NS_FRONTEND_REPO: z.string().optional(),
  NS_MANAGER_REPO: z.string().optional(),

  // ─── Identidade do produto (OBRIGATÓRIAS) ───
  NS_PRODUCT_NAME: z.string().min(1, "NS_PRODUCT_NAME é obrigatória"),
  NS_BACKEND_MODULE: z.string().min(1, "NS_BACKEND_MODULE é obrigatória"),
  NS_BACKEND_CORE_MODULE: z.string().optional(),
  NS_BACKEND_REPO_NAME: z.string().min(1, "NS_BACKEND_REPO_NAME é obrigatória"),
  NS_MANAGER_REPO_NAME: z.string().min(1, "NS_MANAGER_REPO_NAME é obrigatória"),

  // ─── Volume de seed (OBRIGATÓRIA) ───
  NS_SEED_VOLUME: z.string().min(1, "NS_SEED_VOLUME é obrigatória"),

  // ─── Credenciais PostgreSQL (opcionais com defaults) ───
  NS_DB_USER: z.string().default("postgres"),
  NS_DB_PASSWORD: z.string().default("docker"),
  NS_DB_NAME: z.string().default("app_database"),

  // ─── Portas (opcionais com defaults) ───
  NS_MASTER_DB_PORT: z.coerce.number().default(5434),
  NS_MASTER_BACKEND_PORT: z.coerce.number().default(8080),
  NS_MASTER_FRONTEND_PORT: z.coerce.number().default(3011),
  NS_MASTER_MANAGER_PORT: z.coerce.number().default(3020),
  NS_PORTLESS_PROXY_PORT: z.coerce.number().default(1355),
});

export type EnvVars = z.infer<typeof envSchema>;

// ─── Load envs from file + process.env ───

let _env: EnvVars;
let _missing: string[] = [];

export function getMissingVars(): string[] {
  return [..._missing];
}

export function isConfigured(): boolean {
  return _missing.length === 0;
}

function readEnvFileSync(): Record<string, string> {
  try {
    const filePath = join(homedir(), ".config", "ns", "env.json");
    if (existsSync(filePath)) {
      const content = readFileSync(filePath, "utf8");
      if (content) {
        const parsed = JSON.parse(content);
        const result: Record<string, string> = {};
        for (const [key, value] of Object.entries(parsed)) {
          if (value !== null && value !== undefined) {
            result[key] = String(value);
          }
        }
        return result;
      }
    }
  } catch {
    // ignore
  }
  return {};
}

function buildEnv(): EnvVars {
  const fileVars = readEnvFileSync();
  const merged: Record<string, any> = { ...fileVars, ...process.env };

  const result = envSchema.safeParse(merged);

  if (result.success) {
    _missing = [];
    return result.data;
  }

  _missing = result.error.issues.map((i) => String(i.path[0]));

  // Fill missing required fields with placeholder so the module doesn't crash
  const partial = { ...merged };
  for (const key of _missing) {
    if (partial[key] === undefined || partial[key] === null || partial[key] === "") {
      partial[key] = "__unset__";
    }
  }

  // Second parse with placeholders — must succeed
  const retry = envSchema.safeParse(partial);
  if (retry.success) {
    return retry.data;
  }

  // Should never reach here if placeholders are correct
  throw new Error("Failed to build env even with placeholders: " + retry.error.message);
}

export let env: EnvVars;

// ─── Computed paths ───
export let BASE_DIR: string;
export let WORKSPACE_DIR: string;
export let TEMPLATES_DIR: string;
export let WORKTREES_DIR: string;
export let SNAPSHOTS_DIR: string;

export let BACKEND_REPO: string;
export let FRONTEND_REPO: string;
export let MANAGER_REPO: string;

// ─── Computed constants ───
export let MASTER_DB_PORT: number;
export let MASTER_BACKEND_PORT: number;
export let MASTER_FRONTEND_PORT: number;
export let MASTER_MANAGER_PORT: number;
export let PORTLESS_PROXY_PORT: number;

export let DB_USER: string;
export let DB_PASSWORD: string;
export let DB_NAME: string;
export let SEED_VOLUME: string;

export let PRODUCT_NAME: string;
export let BACKEND_MODULE: string;
export let BACKEND_CORE_MODULE: string;

function applyEnv(nextEnv: EnvVars): void {
  _env = nextEnv;
  env = _env;

  BASE_DIR = env.NS_BASE_DIR;
  WORKSPACE_DIR = join(BASE_DIR, `${env.NS_PRODUCT_NAME}-workspace`);
  TEMPLATES_DIR = join(WORKSPACE_DIR, "templates");
  WORKTREES_DIR = join(BASE_DIR, "worktrees");
  SNAPSHOTS_DIR = join(WORKSPACE_DIR, "snapshots");

  BACKEND_REPO = env.NS_BACKEND_REPO || join(BASE_DIR, env.NS_BACKEND_REPO_NAME);
  FRONTEND_REPO = env.NS_FRONTEND_REPO || join(BASE_DIR, "frontend");
  MANAGER_REPO = env.NS_MANAGER_REPO || join(BASE_DIR, env.NS_MANAGER_REPO_NAME);

  MASTER_DB_PORT = env.NS_MASTER_DB_PORT;
  MASTER_BACKEND_PORT = env.NS_MASTER_BACKEND_PORT;
  MASTER_FRONTEND_PORT = env.NS_MASTER_FRONTEND_PORT;
  MASTER_MANAGER_PORT = env.NS_MASTER_MANAGER_PORT;
  PORTLESS_PROXY_PORT = env.NS_PORTLESS_PROXY_PORT;

  DB_USER = env.NS_DB_USER;
  DB_PASSWORD = env.NS_DB_PASSWORD;
  DB_NAME = env.NS_DB_NAME;
  SEED_VOLUME = env.NS_SEED_VOLUME;

  PRODUCT_NAME = env.NS_PRODUCT_NAME;
  BACKEND_MODULE = env.NS_BACKEND_MODULE;
  BACKEND_CORE_MODULE = env.NS_BACKEND_CORE_MODULE || `${env.NS_BACKEND_MODULE}-core`;
}

// Synchronous load on first import
applyEnv(buildEnv());

// ─── Workspace Env Schema ───
export const workspaceEnvSchema = z.object({
  BRANCH_NAME: z.string(),
  BRANCH_SLUG: z.string(),
  DB_PORT: z.coerce.number(),
  BACKEND_PORT: z.coerce.number(),
  BACKEND_DEBUG_PORT: z.coerce.number().optional(),
  FRONTEND_PORT: z.coerce.number(),
  MANAGER_PORT: z.coerce.number().optional(),
  DB_VOLUME: z.string(),
  DB_CONTAINER: z.string(),
  COMPOSE_PROJECT: z.string(),
  DB_USER: z.string().default(() => env.NS_DB_USER),
  DB_PASSWORD: z.string().default(() => env.NS_DB_PASSWORD),
  DB_NAME: z.string().default(() => env.NS_DB_NAME),
});

export type WorkspaceEnv = z.infer<typeof workspaceEnvSchema>;

// ─── Helper to reload after init ───
export async function reloadEnv(): Promise<void> {
  applyEnv(buildEnv());
}
