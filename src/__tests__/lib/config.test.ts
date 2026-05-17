import { describe, test, expect, mock } from "bun:test";
import {
  readWorkspaceEnv,
  branchExists,
  slugify,
} from "../../lib/config";

describe("config", () => {
  test("slugify converts to lowercase and replaces special chars", () => {
    expect(slugify("FEAT-123")).toBe("feat-123");
    expect(slugify("PRD-999")).toBe("prd-999");
    expect(slugify("HOTFIX_123")).toBe("hotfix-123");
  });

  test("readWorkspaceEnv parses env file", async () => {
    const content = `BRANCH_NAME="FEAT-123"
BRANCH_SLUG="feat-123"
DB_PORT="5438"
BACKEND_PORT="8084"
FRONTEND_PORT="3015"
MANAGER_PORT="3021"
DB_VOLUME="vol"
DB_CONTAINER="container"
COMPOSE_PROJECT="project"`;

    const originalFile = Bun.file;
    Bun.file = mock(() => ({
      text: () => Promise.resolve(content),
      exists: () => true,
    })) as any;

    const env = await readWorkspaceEnv("FEAT-123");
    expect(env?.BRANCH_NAME).toBe("FEAT-123");
    expect(env?.DB_PORT).toBe(5438);
    expect(env?.MANAGER_PORT).toBe(3021);

    Bun.file = originalFile;
  });

  test("readWorkspaceEnv returns null on error", async () => {
    const originalFile = Bun.file;
    Bun.file = mock(() => ({
      text: () => Promise.reject(new Error("not found")),
    })) as any;

    const env = await readWorkspaceEnv("NONEXISTENT");
    expect(env).toBeNull();

    Bun.file = originalFile;
  });

  test("branchExists checks for workspace env", () => {
    const originalFile = Bun.file;
    Bun.file = mock(() => ({
      exists: () => true,
    })) as any;

    expect(branchExists("FEAT-123")).toBe(true);

    Bun.file = originalFile;
  });
});
