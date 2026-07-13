import { describe, test, expect, mock } from "bun:test";
import { newAction } from "../../actions/new";
import { SEED_VOLUME } from "../../lib/config";
import { createShellResult } from "../setup";

class ProcessExit extends Error {}

describe("newAction paths", () => {
  const createMocks = () => ({
    branchExistsOrigin: mock((repo: string, branch: string) => Promise.resolve(branch === "master")),
    fetch: mock((repo: string) => Promise.resolve()),
    trackBranch: mock((repo: string, branch: string) => Promise.resolve()),
    localBranch: mock((repo: string, branch: string, base: string) => Promise.resolve()),
    localExists: mock((repo: string, branch: string) => true),
    worktree: mock((repo: string, path: string, branch: string) => Promise.resolve()),
    allocate: mock((withManager?: boolean) => ({ db: 5438, backend: 8084, backendDebug: 5005, frontend: 3015 })),
    volumeCreate: mock((name: string) => Promise.resolve()),
    volumeCopy: mock((source: string, target: string) => Promise.resolve()),
    shell: mock((cmd: string[]) => Promise.resolve(createShellResult(cmd))),
    markTouched: mock(() => Promise.resolve()),
  });

  test("uses existing remote branch", async () => {
    const mocks = createMocks();
    mocks.branchExistsOrigin = mock((repo: string, branch: string) => Promise.resolve(
      branch === "master" || (branch === "feat-123" && repo.includes("backend"))
    ));
    mocks.localExists = mock((repo: string, branch: string) => branch === "master");
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
      expect(mocks.trackBranch).toHaveBeenCalled();
    } finally {
      Bun.file = originalFile;
    }
  });

  test("uses existing remote branch from docs", async () => {
    const mocks = createMocks();
    mocks.branchExistsOrigin = mock((repo: string, branch: string) => Promise.resolve(
      branch === "master" || (branch === "feat-123" && repo.endsWith("/docs"))
    ));
    mocks.localExists = mock((repo: string, branch: string) => branch === "master");
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
      expect(mocks.trackBranch).toHaveBeenCalledWith(expect.stringContaining("docs"), "feat-123");
    } finally {
      Bun.file = originalFile;
    }
  });

  test("creates local branches from origin base", async () => {
    const mocks = createMocks();
    mocks.localExists = mock((repo: string, branch: string) => branch === "master");
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
      expect(mocks.localBranch).toHaveBeenCalledWith(expect.any(String), "feat-123", "origin/master");
    } finally {
      Bun.file = originalFile;
    }
  });

  test("exits when base branch missing in backend", async () => {
    const mocks = createMocks();
    mocks.branchExistsOrigin = mock((repo: string, branch: string) => Promise.resolve(
      branch === "develop" && !repo.includes("backend")
    ));
    const originalFile = Bun.file;
    Bun.file = mock((path: string) => ({
      exists: () => Promise.resolve(path.includes(".git")),
    })) as any;
    try {
      await newAction("feat-123", "develop", false, mocks);
      expect(false).toBe(true);
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      expect((e as Error).message).toContain("origin/develop");
    } finally {
      Bun.file = originalFile;
    }
  });

  test("exits when base branch missing in manager", async () => {
    const mocks = createMocks();
    mocks.branchExistsOrigin = mock((repo: string, branch: string) => Promise.resolve(
      branch === "master" && !repo.includes("manager")
    ));
    const originalFile = Bun.file;
    Bun.file = mock((path: string) => ({
      exists: () => Promise.resolve(path.includes(".git")),
    })) as any;
    try {
      await newAction("feat-123", "master", true, mocks);
      expect(false).toBe(true);
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      expect((e as Error).message).toContain("origin/master");
    } finally {
      Bun.file = originalFile;
    }
  });

  test("exits when base branch missing in docs", async () => {
    const mocks = createMocks();
    mocks.branchExistsOrigin = mock((repo: string, branch: string) => Promise.resolve(
      branch === "master" && !repo.endsWith("/docs")
    ));
    const originalFile = Bun.file;
    Bun.file = mock((path: string) => ({
      exists: () => Promise.resolve(path.includes(".git")),
    })) as any;
    try {
      await newAction("feat-123", "master", false, mocks);
      expect(false).toBe(true);
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      expect((e as Error).message).toContain("origin/master");
      expect((e as Error).message).toContain("docs");
    } finally {
      Bun.file = originalFile;
    }
  });

  test("seeds database from source volume", async () => {
    const mocks = createMocks();
    mocks.shell = mock((cmd: string[]) => {
      if (cmd.includes("volume") && cmd.includes("ls")) {
        return Promise.resolve(createShellResult(cmd, { stdout: `${SEED_VOLUME}\n` }));
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
          ? 'SEEDED_FROM="master"'
          : ""
      ),
    })) as any;
    try {
      await newAction("feat-123", "master", false, mocks);
      expect(mocks.volumeCopy).toHaveBeenCalled();
    } finally {
      Bun.file = originalFile;
    }
  });

  test("skips seed when source volume missing", async () => {
    const mocks = createMocks();
    mocks.shell = mock((cmd: string[]) => {
      if (cmd.includes("volume") && cmd.includes("ls")) {
        return Promise.resolve(createShellResult(cmd, { stdout: "\n" }));
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
      text: () => Promise.resolve(""),
    })) as any;
    try {
      await newAction("feat-123", "master", false, mocks);
      expect(mocks.volumeCopy).not.toHaveBeenCalled();
    } finally {
      Bun.file = originalFile;
    }
  });

  test("exits when worktree already exists", async () => {
    const mocks = createMocks();
    const originalFile = Bun.file;
    Bun.file = mock((path: string) => ({
      exists: () => Promise.resolve(
        path.includes(".git") ||
        path.includes("worktrees")
      ),
    })) as any;
    try {
      await newAction("feat-123", "master", false, mocks);
      expect(false).toBe(true);
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      expect((e as Error).message).toContain("já existe");
    } finally {
      Bun.file = originalFile;
    }
  });
});
