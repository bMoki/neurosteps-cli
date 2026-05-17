import { describe, test, expect, mock } from "bun:test";
import { hasManager, branchExists, listBranches } from "../../lib/config";

describe("config error handling", () => {
  test("hasManager returns false on error", () => {
    const originalFile = Bun.file;
    Bun.file = mock(() => {
      throw new Error("fail");
    }) as any;

    expect(hasManager("test")).toBe(false);

    Bun.file = originalFile;
  });

  test("branchExists returns false on error", () => {
    const originalFile = Bun.file;
    Bun.file = mock(() => {
      throw new Error("fail");
    }) as any;

    expect(branchExists("test")).toBe(false);

    Bun.file = originalFile;
  });

  test("listBranches returns empty on error", () => {
    const originalSpawnSync = Bun.spawnSync;
    Bun.spawnSync = mock(() => {
      throw new Error("fail");
    }) as any;

    expect(listBranches()).toEqual([]);

    Bun.spawnSync = originalSpawnSync;
  });
});
