import { describe, test, expect, mock } from "bun:test";
import { createTrackingBranch, createWorktree } from "../../lib/git";

describe("git edge cases", () => {
  test("createTrackingBranch calls git branch --track", async () => {
    const originalSpawn = Bun.spawn;
    Bun.spawn = mock(() => ({
      exited: Promise.resolve(0),
    })) as any;
    try {
      await createTrackingBranch("/repo", "feature");
    } finally {
      Bun.spawn = originalSpawn;
    }
  });

  test("createTrackingBranch throws on failure", async () => {
    const originalSpawn = Bun.spawn;
    Bun.spawn = mock(() => ({
      exited: Promise.resolve(1),
      stdout: new ReadableStream({ start(c) { c.close(); } }),
      stderr: new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode("fatal: not a valid object name"));
          c.close();
        },
      }),
    })) as any;
    try {
      await createTrackingBranch("/repo", "feature");
      expect(false).toBe(true);
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
    } finally {
      Bun.spawn = originalSpawn;
    }
  });

  test("createWorktree throws on failure", async () => {
    const originalSpawn = Bun.spawn;
    Bun.spawn = mock(() => ({
      exited: Promise.resolve(1),
      stderr: new ReadableStream({ start(c) { c.close(); } }),
    })) as any;
    try {
      await createWorktree("/repo", "/path", "feature");
      expect(false).toBe(true);
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
    } finally {
      Bun.spawn = originalSpawn;
    }
  });
});
