import { describe, test, expect, mock } from "bun:test";
import { readWorkspaceEnv } from "../../lib/config";

describe("config edge cases", () => {
  test("readWorkspaceEnv handles missing manager port", async () => {
    const content = `BRANCH_NAME="test"
BRANCH_SLUG="test"
DB_PORT="5432"
BACKEND_PORT="8080"
FRONTEND_PORT="3000"
DB_VOLUME="vol"
DB_CONTAINER="container"
COMPOSE_PROJECT="project"`;

    const originalFile = Bun.file;
    Bun.file = mock(() => ({
      text: () => Promise.resolve(content),
      exists: () => true,
    })) as any;

    const env = await readWorkspaceEnv("test");
    expect(env?.MANAGER_PORT).toBeUndefined();

    Bun.file = originalFile;
  });
});
