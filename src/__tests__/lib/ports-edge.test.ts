import { describe, test, expect, mock } from "bun:test";
import { isPortAvailable } from "../../lib/ports";

describe("ports edge cases", () => {
  test("isPortAvailable throws on lsof exception", () => {
    const originalSpawnSync = Bun.spawnSync;
    Bun.spawnSync = mock(() => {
      throw new Error("spawn error");
    }) as any;

    expect(() => isPortAvailable(8080)).toThrow("Falha ao verificar porta 8080 com lsof");

    Bun.spawnSync = originalSpawnSync;
  });
});
