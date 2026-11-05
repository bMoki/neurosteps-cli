import { mock } from "bun:test";
import { join } from "path";
import { SNAPSHOTS_DIR } from "../../lib/config";
import { createMockWorkspaceEnv } from "../setup";

/** Deps de Snapshot sobre um disco em memória, com docker de mentira. */
export function createSnapshotDeps() {
  const files = new Map<string, string>();
  const dirs = new Set<string>();

  const deps = {
    readEnv: mock((_branch: string) => Promise.resolve(createMockWorkspaceEnv() as any)),
    composeDown: mock(() => Promise.resolve()),
    volumeCreate: mock((_volume: string) => Promise.resolve()),
    volumeRm: mock((_volume: string) => Promise.resolve()),
    volumeCopy: mock((_from: string, _to: string) => Promise.resolve()),
    composeUp: mock(() => Promise.resolve()),
    waitPg: mock(() => Promise.resolve()),
    mkdir: mock((path: string) => {
      dirs.add(path);
      return Promise.resolve(undefined);
    }),
    readText: mock((path: string) => {
      const value = files.get(path);
      return value === undefined ? Promise.reject(new Error(`ENOENT: ${path}`)) : Promise.resolve(value);
    }),
    writeText: mock((path: string, content: string) => {
      files.set(path, content);
      return Promise.resolve(undefined);
    }),
    readDir: mock((path: string) => {
      const prefix = `${path}/`;
      const entries = new Set<string>();
      for (const file of files.keys()) {
        const rest = file.startsWith(prefix) ? file.slice(prefix.length) : "";
        if (rest && !rest.includes("/")) entries.add(rest);
      }
      return Promise.resolve([...entries]);
    }),
    unlink: mock((path: string) => {
      files.delete(path);
      return Promise.resolve(undefined);
    }),
    rm: mock((path: string, _opts?: object) => {
      files.delete(path);
      return Promise.resolve(undefined);
    }),
    pathExists: mock((path: string) => dirs.has(path) || files.has(path)),
    listBranches: mock(() => ["feat-123"]),
  };

  /** Grava um Snapshot da branch no disco em memória. */
  function addSnapshot(branch: string, name: string, createdAt = "2026-05-07T11:00:00.000Z", volume = `vol-${branch}-${name}`) {
    const dir = join(SNAPSHOTS_DIR, branch);
    dirs.add(dir);
    files.set(join(dir, `${name}.json`), JSON.stringify({
      name,
      slug: name,
      volume,
      created_at: createdAt,
      source_branch: branch,
      source_volume: `db-${branch}`,
    }));
    return dir;
  }

  return { deps: deps as any, files, dirs, addSnapshot };
}
