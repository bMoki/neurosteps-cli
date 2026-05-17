import { describe, test, expect, mock } from "bun:test";
import { dockerVolumeExists, isPostgresReady } from "../../lib/docker";

describe("docker", () => {
  test("dockerVolumeExists checks volume list", async () => {
    const originalSpawn = Bun.spawn;
    Bun.spawn = mock(() => ({
      exited: Promise.resolve(0),
      stdout: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("vol1\nvol2\n"));
          controller.close();
        }
      }),
    })) as any;

    const exists = await dockerVolumeExists("vol1");
    expect(exists).toBe(true);

    Bun.spawn = originalSpawn;
  });

  test("isPostgresReady returns true when pg_isready succeeds", async () => {
    const originalSpawn = Bun.spawn;
    Bun.spawn = mock(() => ({
      exited: Promise.resolve(0),
    })) as any;

    const ready = await isPostgresReady("my-container");
    expect(ready).toBe(true);

    Bun.spawn = originalSpawn;
  });
});
