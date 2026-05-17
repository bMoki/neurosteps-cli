import { describe, test, expect, mock } from "bun:test";
import {
  resolveBackendDir,
  resolveFrontendDir,
  resolveManagerDir,
  hasManager,
  listBranches,
  readWorkspaceEnv,
} from "../../lib/config";

describe("config helpers", () => {
  test("resolveBackendDir prefers worktree", () => {
    const originalFile = Bun.file;
    Bun.file = mock(() => ({
      exists: () => true,
    })) as any;

    const dir = resolveBackendDir("feat-123");
    expect(dir).toContain("worktrees");

    Bun.file = originalFile;
  });

  test("resolveBackendDir falls back to repo", () => {
    const originalFile = Bun.file;
    Bun.file = mock(() => ({
      exists: () => false,
    })) as any;

    const dir = resolveBackendDir("master");
    expect(dir).toContain("scalemed-backend");

    Bun.file = originalFile;
  });

  test("resolveFrontendDir prefers worktree", () => {
    const originalFile = Bun.file;
    Bun.file = mock(() => ({
      exists: () => true,
    })) as any;

    const dir = resolveFrontendDir("feat-123");
    expect(dir).toContain("worktrees");

    Bun.file = originalFile;
  });

  test("resolveManagerDir prefers worktree", () => {
    const originalFile = Bun.file;
    Bun.file = mock(() => ({
      exists: () => true,
    })) as any;

    const dir = resolveManagerDir("feat-123");
    expect(dir).toContain("worktrees");

    Bun.file = originalFile;
  });

  test("hasManager checks worktree", () => {
    const originalFile = Bun.file;
    Bun.file = mock(() => ({
      exists: () => true,
    })) as any;

    expect(hasManager("feat-123")).toBe(true);

    Bun.file = originalFile;
  });

  test("listBranches returns directories", () => {
    const originalSpawnSync = Bun.spawnSync;
    Bun.spawnSync = mock(() => ({
      stdout: new TextEncoder().encode("master\nfeat-123\n"),
      exitCode: 0,
    })) as any;

    const branches = listBranches();
    expect(branches).toContain("master");
    expect(branches).toContain("feat-123");

    Bun.spawnSync = originalSpawnSync;
  });

  test("readWorkspaceEnv reads persisted database settings", async () => {
    const originalFile = Bun.file;
    Bun.file = mock(() => ({
      text: () => Promise.resolve(`BRANCH_NAME="feat-123"
BRANCH_SLUG="feat-123"
DB_PORT="5438"
BACKEND_PORT="8084"
BACKEND_DEBUG_PORT="5005"
FRONTEND_PORT="3015"
MANAGER_PORT="3021"
DB_VOLUME="myapp_db_feat-123"
DB_CONTAINER="myapp-psql-feat-123"
DB_USER="custom_user"
DB_PASSWORD="custom_pass"
DB_NAME="custom_db"
COMPOSE_PROJECT="ns-feat-123"
`),
    })) as any;

    try {
      const env = await readWorkspaceEnv("feat-123");

      expect(env?.DB_USER).toBe("custom_user");
      expect(env?.DB_PASSWORD).toBe("custom_pass");
      expect(env?.DB_NAME).toBe("custom_db");
    } finally {
      Bun.file = originalFile;
    }
  });

  test("readWorkspaceEnv falls back to docker-compose database settings", async () => {
    const originalFile = Bun.file;
    Bun.file = mock((path: string) => ({
      text: () => Promise.resolve(
        path.endsWith("docker-compose.yml")
          ? `services:
  db:
    environment:
      - POSTGRESQL_USERNAME=compose_user
      - POSTGRESQL_PASSWORD=compose_pass
      - POSTGRESQL_DATABASE=compose_db
`
          : `BRANCH_NAME="feat-123"
BRANCH_SLUG="feat-123"
DB_PORT="5438"
BACKEND_PORT="8084"
BACKEND_DEBUG_PORT="5005"
FRONTEND_PORT="3015"
MANAGER_PORT="3021"
DB_VOLUME="myapp_db_feat-123"
DB_CONTAINER="myapp-psql-feat-123"
COMPOSE_PROJECT="ns-feat-123"
`,
      ),
    })) as any;

    try {
      const env = await readWorkspaceEnv("feat-123");

      expect(env?.DB_USER).toBe("compose_user");
      expect(env?.DB_PASSWORD).toBe("compose_pass");
      expect(env?.DB_NAME).toBe("compose_db");
    } finally {
      Bun.file = originalFile;
    }
  });
});
