import { mock } from "bun:test";
import type { ShellResult } from "../lib/shell";

// Generic test fixtures — no product names, no real paths
export const TEST_BRANCH = "feat-123";
export const TEST_BRANCH_SLUG = "feat-123";
export const TEST_DB_PORT = 5438;
export const TEST_BACKEND_PORT = 8084;
export const TEST_BACKEND_DEBUG_PORT = 5005;
export const TEST_FRONTEND_PORT = 3015;
export const TEST_MANAGER_PORT = 3021;
export const TEST_DB_VOLUME = "myapp_db_feat-123";
export const TEST_DB_CONTAINER = "myapp-psql-feat-123";
export const TEST_COMPOSE_PROJECT = "ns-feat-123";

export function createShellResult(command: string[], overrides: Partial<ShellResult> = {}): ShellResult {
  return {
    exitCode: 0,
    stdout: "",
    stderr: "",
    command,
    ...overrides,
  };
}

export function mockBunShell() {
  return mock((command: string[]) => Promise.resolve(createShellResult(command)));
}

export function mockBunFile(content = "") {
  return {
    text: () => Promise.resolve(content),
    textSync: () => content,
    exists: () => true,
  };
}

export function createMockWorkspaceEnv(overrides: Record<string, unknown> = {}) {
  return {
    BRANCH_NAME: TEST_BRANCH,
    BRANCH_SLUG: TEST_BRANCH_SLUG,
    DB_PORT: TEST_DB_PORT,
    BACKEND_PORT: TEST_BACKEND_PORT,
    BACKEND_DEBUG_PORT: TEST_BACKEND_DEBUG_PORT,
    FRONTEND_PORT: TEST_FRONTEND_PORT,
    MANAGER_PORT: TEST_MANAGER_PORT,
    DB_VOLUME: TEST_DB_VOLUME,
    DB_CONTAINER: TEST_DB_CONTAINER,
    COMPOSE_PROJECT: TEST_COMPOSE_PROJECT,
    DB_USER: "postgres",
    DB_PASSWORD: "docker",
    DB_NAME: "app_database",
    ...overrides,
  };
}
