import { describe, test, expect, mock } from "bun:test";
import { dockerVolumeCopy, dockerPs } from "../../lib/docker";

describe("docker remaining coverage", () => {
  test("dockerVolumeCopy throws on failure", async () => {
    const originalSpawn = Bun.spawn;
    Bun.spawn = mock(() => ({
      exited: Promise.resolve(1),
      stdout: new ReadableStream({ start(c) { c.close(); } }),
      stderr: new ReadableStream({ start(c) { c.close(); } }),
    })) as any;

    try {
      await dockerVolumeCopy("from", "to");
      expect(false).toBe(true);
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
    }

    Bun.spawn = originalSpawn;
  });

  test("dockerPs checks container list", async () => {
    const originalSpawn = Bun.spawn;
    Bun.spawn = mock(() => ({
      exited: Promise.resolve(0),
      stdout: new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode("container1\ncontainer2\n"));
          c.close();
        }
      }),
    })) as any;

    const running = await dockerPs("container1");
    expect(running).toBe(true);

    const notRunning = await dockerPs("container3");
    expect(notRunning).toBe(false);

    Bun.spawn = originalSpawn;
  });
});
