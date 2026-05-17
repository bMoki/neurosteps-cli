import { afterEach, describe, expect, mock, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { dirExists, pathExists, pathExistsAsync } from "../../lib/filesystem";

describe("filesystem helpers", () => {
  const originalFile = Bun.file;

  afterEach(() => {
    Bun.file = originalFile;
  });

  test("pathExists uses sync Bun.file mocks", () => {
    Bun.file = mock(() => ({
      exists: () => true,
    })) as any;

    expect(pathExists("/mocked/path")).toBe(true);
  });

  test("pathExists returns false when sync check throws", () => {
    Bun.file = mock(() => {
      throw new Error("fail");
    }) as any;

    expect(pathExists("/mocked/path")).toBe(false);
  });

  test("pathExistsAsync uses async Bun.file mocks", async () => {
    Bun.file = mock(() => ({
      exists: () => Promise.resolve(true),
    })) as any;

    expect(await pathExistsAsync("/mocked/path")).toBe(true);
  });

  test("pathExistsAsync does not fall back to real fs while Bun.file is mocked", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ns-fs-"));
    const file = join(dir, "real-file");
    writeFileSync(file, "content");

    Bun.file = mock(() => ({
      exists: () => Promise.resolve(false),
    })) as any;

    try {
      expect(await pathExistsAsync(file)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("pathExistsAsync checks real paths when Bun.file is not mocked", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ns-fs-"));
    const file = join(dir, "real-file");
    writeFileSync(file, "content");

    try {
      expect(await pathExistsAsync(file)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("dirExists distinguishes directories from files with real paths", () => {
    const dir = mkdtempSync(join(tmpdir(), "ns-fs-"));
    const file = join(dir, "real-file");
    writeFileSync(file, "content");

    try {
      expect(dirExists(dir)).toBe(true);
      expect(dirExists(file)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
