import { describe, test, expect, mock } from "bun:test";
import { createLocalBranch, createWorktree, deleteBranch, localBranchExists, removeWorktree } from "../../lib/git";

describe("git error paths", () => {
  test("createLocalBranch throws on failure", async () => {
    const originalSpawn = Bun.spawn;
    Bun.spawn = mock(() => ({
      exited: Promise.resolve(1),
      stdout: new ReadableStream({ start(c) { c.close(); } }),
      stderr: new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode("fatal: not a valid object name"));
          c.close();
        }
      }),
    })) as any;

    try {
      await createLocalBranch("/repo", "feature", "nonexistent");
      expect(false).toBe(true);
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
    } finally {
      Bun.spawn = originalSpawn;
    }
  });

  test("removeWorktree throws on failure", async () => {
    const originalSpawn = Bun.spawn;
    Bun.spawn = mock(() => ({
      exited: Promise.resolve(1),
      stdout: new ReadableStream({ start(c) { c.close(); } }),
      stderr: new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode("fatal: not a working tree"));
          c.close();
        },
      }),
    })) as any;

    try {
      await expect(removeWorktree("/repo", "/missing")).rejects.toThrow("Falha ao remover worktree /missing");
    } finally {
      Bun.spawn = originalSpawn;
    }
  });

  test("createWorktree does not retry unrelated failures", async () => {
    const originalSpawn = Bun.spawn;
    const spawn = mock(() => ({
      exited: Promise.resolve(128),
      stdout: new ReadableStream({ start(c) { c.close(); } }),
      stderr: new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode("fatal: 'feature' is already checked out"));
          c.close();
        },
      }),
    })) as any;
    Bun.spawn = spawn;

    try {
      await expect(createWorktree("/repo", "/path", "feature")).rejects.toThrow("Falha ao criar worktree /path");
      expect(spawn).toHaveBeenCalledTimes(1);
    } finally {
      Bun.spawn = originalSpawn;
    }
  });

  test("deleteBranch throws on failure", async () => {
    const originalSpawn = Bun.spawn;
    Bun.spawn = mock(() => ({
      exited: Promise.resolve(1),
      stdout: new ReadableStream({ start(c) { c.close(); } }),
      stderr: new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode("error: branch not found"));
          c.close();
        },
      }),
    })) as any;

    try {
      await expect(deleteBranch("/repo", "missing")).rejects.toThrow("Falha ao remover branch local missing");
    } finally {
      Bun.spawn = originalSpawn;
    }
  });

  test("localBranchExists throws on git errors", () => {
    const originalSpawnSync = Bun.spawnSync;
    Bun.spawnSync = mock(() => ({
      exitCode: 128,
      stdout: new Uint8Array(),
      stderr: new TextEncoder().encode("fatal: not a git repository"),
    })) as any;

    try {
      expect(() => localBranchExists("/repo", "main")).toThrow("Falha ao verificar branch local main");
    } finally {
      Bun.spawnSync = originalSpawnSync;
    }
  });
});
