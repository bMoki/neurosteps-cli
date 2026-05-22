import { describe, test, expect, mock } from "bun:test";
import {
  branchExistsOnOrigin,
  createLocalBranch,
  createWorktree,
  removeWorktree,
  deleteBranch,
  fetchOrigin,
  localBranchExists,
} from "../../lib/git";

describe("git", () => {
  test("branchExistsOnOrigin checks remote", async () => {
    const originalSpawn = Bun.spawn;
    Bun.spawn = mock(() => ({
      exited: Promise.resolve(0),
      stdout: new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode("abc123 refs/heads/main\n"));
          c.close();
        }
      }),
    })) as any;

    const exists = await branchExistsOnOrigin("/repo", "main");
    expect(exists).toBe(true);

    Bun.spawn = originalSpawn;
  });

  test("localBranchExists checks ref", () => {
    const originalSpawnSync = Bun.spawnSync;
    Bun.spawnSync = mock(() => ({ exitCode: 0 })) as any;

    expect(localBranchExists("/repo", "main")).toBe(true);

    Bun.spawnSync = originalSpawnSync;
  });

  test("fetchOrigin calls git fetch", async () => {
    const originalSpawn = Bun.spawn;
    Bun.spawn = mock(() => ({
      exited: Promise.resolve(0),
    })) as any;

    await fetchOrigin("/repo");

    Bun.spawn = originalSpawn;
  });

  test("createLocalBranch calls git branch", async () => {
    const originalSpawn = Bun.spawn;
    Bun.spawn = mock(() => ({
      exited: Promise.resolve(0),
    })) as any;

    await createLocalBranch("/repo", "feature", "main");

    Bun.spawn = originalSpawn;
  });

  test("createWorktree calls git worktree add", async () => {
    const originalSpawn = Bun.spawn;
    const spawn = mock(() => ({
      exited: Promise.resolve(0),
    })) as any;
    Bun.spawn = spawn;

    try {
      await createWorktree("/repo", "/path", "feature");
      expect(spawn.mock.calls[0][0]).toEqual([
        "git",
        "-C",
        "/repo",
        "worktree",
        "add",
        "/path",
        "feature",
      ]);
    } finally {
      Bun.spawn = originalSpawn;
    }
  });

  test("createWorktree retries with force when worktree registration is stale", async () => {
    const originalSpawn = Bun.spawn;
    let calls = 0;
    const spawn = mock(() => {
      calls += 1;
      if (calls === 1) {
        return {
          exited: Promise.resolve(128),
          stdout: new ReadableStream({ start(c) { c.close(); } }),
          stderr: new ReadableStream({
            start(c) {
              c.enqueue(new TextEncoder().encode("fatal: '/path' is a missing but already registered worktree"));
              c.close();
            },
          }),
        };
      }

      return { exited: Promise.resolve(0) };
    }) as any;
    Bun.spawn = spawn;

    try {
      await createWorktree("/repo", "/path", "feature");
      expect(spawn).toHaveBeenCalledTimes(2);
      expect(spawn.mock.calls[1][0]).toEqual([
        "git",
        "-C",
        "/repo",
        "worktree",
        "add",
        "-f",
        "/path",
        "feature",
      ]);
    } finally {
      Bun.spawn = originalSpawn;
    }
  });

  test("removeWorktree calls git worktree remove", async () => {
    const originalSpawn = Bun.spawn;
    const spawn = mock(() => ({
      exited: Promise.resolve(0),
    })) as any;
    Bun.spawn = spawn;

    try {
      await removeWorktree("/repo", "/path");
      expect(spawn.mock.calls[0][0]).toEqual([
        "git",
        "-C",
        "/repo",
        "worktree",
        "remove",
        "/path",
      ]);
    } finally {
      Bun.spawn = originalSpawn;
    }
  });

  test("removeWorktree passes force to git worktree remove", async () => {
    const originalSpawn = Bun.spawn;
    const spawn = mock(() => ({
      exited: Promise.resolve(0),
    })) as any;
    Bun.spawn = spawn;

    try {
      await removeWorktree("/repo", "/path", { force: true });
      expect(spawn.mock.calls[0][0]).toEqual([
        "git",
        "-C",
        "/repo",
        "worktree",
        "remove",
        "--force",
        "/path",
      ]);
    } finally {
      Bun.spawn = originalSpawn;
    }
  });

  test("deleteBranch calls git branch -D", async () => {
    const originalSpawn = Bun.spawn;
    Bun.spawn = mock(() => ({
      exited: Promise.resolve(0),
    })) as any;

    await deleteBranch("/repo", "feature");

    Bun.spawn = originalSpawn;
  });
});
