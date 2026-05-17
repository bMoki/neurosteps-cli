import { describe, test, expect, mock } from "bun:test";
import {
  resolveBackendDir,
  resolveFrontendDir,
  resolveManagerDir,
  hasManager,
  listBranches,
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
});
