import { describe, test, expect, mock } from "bun:test";
import { newAction } from "../../actions/new";
import { createShellResult } from "../setup";

describe("newAction", () => {
  const createMocks = () => ({
    branchExistsOrigin: mock((repo: string, branch: string) => Promise.resolve(branch === "master")),
    fetch: mock((repo: string) => Promise.resolve()),
    trackBranch: mock((repo: string, branch: string) => Promise.resolve()),
    localBranch: mock((repo: string, branch: string, base: string) => Promise.resolve()),
    localExists: mock((repo: string, branch: string) => true),
    worktree: mock((repo: string, path: string, branch: string) => Promise.resolve()),
    allocate: mock((withManager?: boolean) => ({ db: 5438, backend: 8084, backendDebug: 5005, frontend: 3015 })),
    copyTpl: mock((src: string, dst: string, variables: Record<string, string>) => Promise.resolve()),
    volumeCreate: mock((name: string) => Promise.resolve()),
    volumeCopy: mock((source: string, target: string) => Promise.resolve()),
    shell: mock((cmd: string[]) => Promise.resolve(createShellResult(cmd))),
    markTouched: mock(() => Promise.resolve()),
  });

  test("creates new branch without manager", async () => {
    const mocks = createMocks();
    mocks.shell = mock((cmd: string[]) => {
      if (cmd.includes("ls") && cmd.some((c) => c.includes("runConfigurations"))) {
        return Promise.resolve(createShellResult(cmd, { stdout: "Quarkus.xml\nWeb.xml\n" }));
      }
      return Promise.resolve(createShellResult(cmd));
    });
    const originalFile = Bun.file;
    Bun.file = mock((path: string) => ({
      exists: () => Promise.resolve(
        path.includes(".git") ||
        !path.includes("worktrees") ||
        path.includes("templates")
      ),
      text: () => Promise.resolve(
        path.includes(".env")
          ? 'BRANCH_NAME="feat-123"'
          : path.includes("json")
          ? "{}"
          : ""
      ),
    })) as any;
    try {
      await newAction("feat-123", "master", false, mocks);
      expect(mocks.allocate).toHaveBeenCalledWith(false);
      expect(mocks.worktree).toHaveBeenCalledTimes(3);
      expect(mocks.markTouched).toHaveBeenCalledWith("feat-123", "new");
    } finally {
      Bun.file = originalFile;
    }
  });

  test("registers backend core pom as IntelliJ Maven project", async () => {
    const mocks = createMocks();
    const originalFile = Bun.file;
    Bun.file = mock((path: string) => ({
      exists: () => Promise.resolve(
        path.includes(".git") ||
        !path.includes("worktrees") ||
        path.includes("templates")
      ),
      text: () => Promise.resolve(""),
    })) as any;
    try {
      await newAction("feat-123", "master", false, mocks);
      expect(mocks.copyTpl).toHaveBeenCalledWith(
        expect.stringContaining("templates/idea/workspace.xml"),
        expect.stringContaining(".idea/workspace.xml"),
        expect.objectContaining({ BACKEND_CORE_MODULE: "scalemed-core" }),
      );
    } finally {
      Bun.file = originalFile;
    }
  });

  test("creates new branch with manager", async () => {
    const mocks = createMocks();
    mocks.allocate = mock((withManager?: boolean) => ({ db: 5438, backend: 8084, backendDebug: 5005, frontend: 3015, manager: 3021 }));
    mocks.shell = mock((cmd: string[]) => {
      if (cmd.includes("ls") && cmd.some((c) => c.includes("runConfigurations"))) {
        return Promise.resolve(createShellResult(cmd, { stdout: "Quarkus.xml\nWeb.xml\n" }));
      }
      return Promise.resolve(createShellResult(cmd));
    });
    const originalFile = Bun.file;
    Bun.file = mock((path: string) => ({
      exists: () => Promise.resolve(
        path.includes(".git") ||
        !path.includes("worktrees") ||
        path.includes("templates")
      ),
      text: () => Promise.resolve(
        path.includes(".env")
          ? 'BRANCH_NAME="feat-123"'
          : path.includes("json")
          ? "{}"
          : ""
      ),
    })) as any;
    try {
      await newAction("feat-123", "master", true, mocks);
      expect(mocks.allocate).toHaveBeenCalledWith(true);
      expect(mocks.worktree).toHaveBeenCalledTimes(4);
      expect(mocks.markTouched).toHaveBeenCalledWith("feat-123", "new");
    } finally {
      Bun.file = originalFile;
    }
  });

  test("exits when manager repo not found", async () => {
    const mocks = createMocks();
    const originalFile = Bun.file;
    // MANAGER_REPO = ~/Developer/neurosteps-manager (from env-setup.ts NS_MANAGER_REPO_NAME)
    Bun.file = mock((path: string) => ({
      exists: () => Promise.resolve(
        path.includes(".git") && !path.includes("neurosteps-manager")
      ),
    })) as any;
    try {
      await newAction("feat-123", "master", true, mocks);
      expect(false).toBe(true);
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      expect((e as Error).message).toContain("não encontrado");
    } finally {
      Bun.file = originalFile;
    }
  });

  test("exits when repo not found", async () => {
    const mocks = createMocks();
    const originalFile = Bun.file;
    // BACKEND_REPO = ~/Developer/scalemed-backend (from env-setup.ts NS_BACKEND_REPO_NAME)
    Bun.file = mock((path: string) => ({
      exists: () => Promise.resolve(
        path.includes(".git") && !path.includes("scalemed-backend")
      ),
    })) as any;
    try {
      await newAction("feat-123", "master", false, mocks);
      expect(false).toBe(true);
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      expect((e as Error).message).toContain("não encontrado");
    } finally {
      Bun.file = originalFile;
    }
  });
});
