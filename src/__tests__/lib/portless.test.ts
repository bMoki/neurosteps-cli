import { describe, test, expect, mock } from "bun:test";
import { registerAlias, removeAlias, listAliases, isProxyRunning, startProxy } from "../../lib/portless";

describe("portless", () => {
  test("registerAlias calls portless alias", async () => {
    const originalSpawn = Bun.spawn;
    Bun.spawn = mock(() => ({
      exited: Promise.resolve(0),
    })) as any;

    await registerAlias("test.api", 8080);

    Bun.spawn = originalSpawn;
  });

  test("removeAlias calls portless alias --remove", async () => {
    const originalSpawn = Bun.spawn;
    Bun.spawn = mock(() => ({
      exited: Promise.resolve(0),
    })) as any;

    await removeAlias("test.api");

    Bun.spawn = originalSpawn;
  });

  test("listAliases returns list", async () => {
    const originalSpawn = Bun.spawn;
    Bun.spawn = mock(() => ({
      exited: Promise.resolve(0),
      stdout: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("alias1\nalias2\n"));
          controller.close();
        }
      }),
    })) as any;

    const aliases = await listAliases();
    expect(aliases).toContain("alias1");

    Bun.spawn = originalSpawn;
  });

  test("isProxyRunning returns true when lsof succeeds", () => {
    const originalSpawnSync = Bun.spawnSync;
    Bun.spawnSync = mock(() => ({ exitCode: 0 })) as any;
    expect(isProxyRunning()).toBe(true);
    Bun.spawnSync = originalSpawnSync;
  });

  test("startProxy calls portless proxy start", async () => {
    const originalSpawn = Bun.spawn;
    Bun.spawn = mock(() => ({
      exited: Promise.resolve(0),
    })) as any;

    await startProxy();

    Bun.spawn = originalSpawn;
  });

  test("registerAlias throws on failure", async () => {
    const originalSpawn = Bun.spawn;
    Bun.spawn = mock(() => ({
      exited: Promise.resolve(1),
      stdout: new ReadableStream({ start(c) { c.close(); } }),
      stderr: new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode("portless failed"));
          c.close();
        },
      }),
    })) as any;

    try {
      await expect(registerAlias("test.api", 8080)).rejects.toThrow("Falha ao registrar alias Portless test.api");
    } finally {
      Bun.spawn = originalSpawn;
    }
  });

  test("removeAlias does not throw when alias does not exist", async () => {
    const originalSpawn = Bun.spawn;
    Bun.spawn = mock(() => ({
      exited: Promise.resolve(1),
      stdout: new ReadableStream({ start(c) { c.close(); } }),
      stderr: new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode("alias not found"));
          c.close();
        },
      }),
    })) as any;

    try {
      await expect(removeAlias("missing.api")).resolves.toBeUndefined();
    } finally {
      Bun.spawn = originalSpawn;
    }
  });

  test("startProxy throws on failure", async () => {
    const originalSpawn = Bun.spawn;
    Bun.spawn = mock(() => ({
      exited: Promise.resolve(1),
      stdout: new ReadableStream({ start(c) { c.close(); } }),
      stderr: new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode("proxy failed"));
          c.close();
        },
      }),
    })) as any;

    try {
      await expect(startProxy()).rejects.toThrow("Falha ao iniciar proxy Portless");
    } finally {
      Bun.spawn = originalSpawn;
    }
  });
});
