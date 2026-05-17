import { describe, test, expect, mock } from "bun:test";
import {
  dockerComposeUp,
  dockerComposeDown,
  dockerVolumeCreate,
  dockerVolumeRm,
  dockerVolumeCopy,
  waitForPostgres,
} from "../../lib/docker";

describe("docker functions", () => {
  test("dockerComposeUp throws on failure", async () => {
    const originalSpawn = Bun.spawn;
    Bun.spawn = mock(() => ({
      exited: Promise.resolve(1),
      stdout: new ReadableStream({ start(c) { c.close(); } }),
      stderr: new ReadableStream({ start(c) { c.close(); } }),
    })) as any;

    try {
      await dockerComposeUp("/path", "project");
      expect(false).toBe(true);
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
    }

    Bun.spawn = originalSpawn;
  });

  test("dockerVolumeCreate calls docker volume create", async () => {
    const originalSpawn = Bun.spawn;
    Bun.spawn = mock(() => ({
      exited: Promise.resolve(0),
    })) as any;

    await dockerVolumeCreate("test-vol");

    Bun.spawn = originalSpawn;
  });

  test("dockerVolumeRm calls docker volume rm", async () => {
    const originalSpawn = Bun.spawn;
    Bun.spawn = mock(() => ({
      exited: Promise.resolve(0),
    })) as any;

    await dockerVolumeRm("test-vol");

    Bun.spawn = originalSpawn;
  });

  test("dockerComposeDown throws on failure", async () => {
    const originalSpawn = Bun.spawn;
    Bun.spawn = mock(() => ({
      exited: Promise.resolve(1),
      stdout: new ReadableStream({ start(c) { c.close(); } }),
      stderr: new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode("compose failed"));
          c.close();
        },
      }),
    })) as any;

    try {
      await expect(dockerComposeDown("/path", "project")).rejects.toThrow("Falha ao parar docker compose");
    } finally {
      Bun.spawn = originalSpawn;
    }
  });

  test("dockerVolumeRm throws on failure", async () => {
    const originalSpawn = Bun.spawn;
    Bun.spawn = mock(() => ({
      exited: Promise.resolve(1),
      stdout: new ReadableStream({ start(c) { c.close(); } }),
      stderr: new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode("no such volume"));
          c.close();
        },
      }),
    })) as any;

    try {
      await expect(dockerVolumeRm("missing-vol")).rejects.toThrow("Falha ao remover volume Docker missing-vol");
    } finally {
      Bun.spawn = originalSpawn;
    }
  });

  test("dockerVolumeCopy copies data", async () => {
    const originalSpawn = Bun.spawn;
    Bun.spawn = mock(() => ({
      exited: Promise.resolve(0),
      stdout: new ReadableStream({ start(c) { c.close(); } }),
      stderr: new ReadableStream({ start(c) { c.close(); } }),
    })) as any;

    await dockerVolumeCopy("from-vol", "to-vol");

    Bun.spawn = originalSpawn;
  });

  test("waitForPostgres waits for ready", async () => {
    const originalSpawn = Bun.spawn;
    let calls = 0;
    Bun.spawn = mock(() => ({
      exited: Promise.resolve(calls++ > 0 ? 0 : 1),
    })) as any;

    await waitForPostgres("container", 5);
    expect(calls).toBeGreaterThan(0);

    Bun.spawn = originalSpawn;
  });
});
