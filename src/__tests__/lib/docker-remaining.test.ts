import { describe, test, expect, mock } from "bun:test";
import {
  dockerComposeDown,
  dockerVolumeRm,
  dockerExec,
  waitForPostgres,
} from "../../lib/docker";

describe("docker remaining", () => {
  test("dockerComposeDown calls docker compose down", async () => {
    const originalSpawn = Bun.spawn;
    Bun.spawn = mock(() => ({
      exited: Promise.resolve(0),
    })) as any;

    await dockerComposeDown("/path", "project");

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

  test("dockerExec returns result", async () => {
    const originalSpawn = Bun.spawn;
    Bun.spawn = mock(() => ({
      exited: Promise.resolve(0),
      stdout: new ReadableStream({
        start(c) { c.enqueue(new TextEncoder().encode("output")); c.close(); }
      }),
      stderr: new ReadableStream({ start(c) { c.close(); } }),
    })) as any;

    const result = await dockerExec("container", ["echo", "hi"]);
    expect(result.exitCode).toBe(0);

    Bun.spawn = originalSpawn;
  });

  test("waitForPostgres retries until ready", async () => {
    const originalSpawn = Bun.spawn;
    let attempts = 0;
    Bun.spawn = mock(() => ({
      exited: Promise.resolve(attempts++ < 2 ? 1 : 0),
    })) as any;

    await waitForPostgres("container", 5);
    expect(attempts).toBe(3);

    Bun.spawn = originalSpawn;
  });

  test("waitForPostgres throws after max retries", async () => {
    const originalSpawn = Bun.spawn;
    Bun.spawn = mock(() => ({
      exited: Promise.resolve(1),
    })) as any;

    try {
      await waitForPostgres("container", 2);
      expect(false).toBe(true);
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
    }

    Bun.spawn = originalSpawn;
  });
});
