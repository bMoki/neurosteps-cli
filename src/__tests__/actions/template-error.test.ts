import { describe, test, expect, mock } from "bun:test";
import { templateFromAction, templateToAction } from "../../actions/template";
import { createMockWorkspaceEnv, createShellResult } from "../setup";

class ProcessExit extends Error {}

describe("template error paths", () => {
  const createMocks = () => ({
    readEnv: mock(() => Promise.resolve(createMockWorkspaceEnv())),
    shell: mock((command: string[]) => Promise.resolve(createShellResult(command))),
  });

  test("templateFromAction exits when no .idea directory", async () => {
    const mocks = createMocks();
    const originalFile = Bun.file;
    Bun.file = mock((path: string) => ({
      exists: () => Promise.resolve(
        path.includes(".workspace.env") && !path.includes(".idea")
      ),
    })) as any;
    const originalExit = process.exit;
    process.exit = ((code: number) => { throw new ProcessExit(String(code)); }) as any;
    try {
      await templateFromAction("feat-123", mocks);
      expect(false).toBe(true);
    } catch (e) {
      expect(e).toBeInstanceOf(ProcessExit);
    } finally {
      process.exit = originalExit;
      Bun.file = originalFile;
    }
  });

  test("templateToAction applies without misc.xml template", async () => {
    const mocks = createMocks();
    const originalFile = Bun.file;
    Bun.file = mock((path: string) => ({
      exists: () => Promise.resolve(
        path.includes(".workspace.env") ||
        path.includes("templates/idea/compiler.xml") ||
        path.includes("templates/runConfigurations")
      ),
      text: () => Promise.resolve("<config>{{DB_PORT}}</config>"),
    })) as any;
    try {
      await templateToAction("feat-123", mocks);
    } finally {
      Bun.file = originalFile;
    }
  });

  test("templateToAction exits when worktree not found", async () => {
    const mocks = createMocks();
    const originalFile = Bun.file;
    Bun.file = mock(() => ({
      exists: () => Promise.resolve(false),
    })) as any;
    const originalExit = process.exit;
    process.exit = ((code: number) => { throw new ProcessExit(String(code)); }) as any;
    try {
      await templateToAction("NONEXISTENT", mocks);
      expect(false).toBe(true);
    } catch (e) {
      expect(e).toBeInstanceOf(ProcessExit);
    } finally {
      process.exit = originalExit;
      Bun.file = originalFile;
    }
  });
});
