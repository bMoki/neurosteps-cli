import { describe, test, mock } from "bun:test";
import { spawnTerminal, openApp } from "../../lib/shell";

describe("shell integration", () => {
  test("spawnTerminal executes without error", async () => {
    const originalSpawn = Bun.spawn;
    Bun.spawn = mock(() => ({
      exited: Promise.resolve(0),
      stdout: { getReader: () => ({ read: () => Promise.resolve({ done: true }) }) },
      stderr: { getReader: () => ({ read: () => Promise.resolve({ done: true }) }) },
    })) as any;

    await spawnTerminal("/tmp", { TEST: "value" }, "echo hello");

    Bun.spawn = originalSpawn;
  });

  test("openApp executes without error", async () => {
    const originalSpawn = Bun.spawn;
    Bun.spawn = mock(() => ({
      exited: Promise.resolve(0),
      stdout: { getReader: () => ({ read: () => Promise.resolve({ done: true }) }) },
      stderr: { getReader: () => ({ read: () => Promise.resolve({ done: true }) }) },
    })) as any;

    await openApp("Finder", "/tmp");

    Bun.spawn = originalSpawn;
  });
});
