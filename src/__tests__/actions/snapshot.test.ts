import { describe, test, expect, mock } from "bun:test";
import { join } from "path";
import { snapshotAction, restoreAction, listSnapshotsAction, rmSnapshotAction, removeBranchSnapshots } from "../../actions/snapshot";
import { SNAPSHOTS_DIR } from "../../lib/config";
import { createMockWorkspaceEnv } from "../setup";

class ProcessExit extends Error {}

function createSnapshotDeps() {
  const files = new Map<string, string>();
  const dirs = new Set<string>();

  const readEnv = mock(() => Promise.resolve(createMockWorkspaceEnv()));
  const composeDown = mock(() => Promise.resolve());
  const volumeCreate = mock(() => Promise.resolve());
  const volumeRm = mock(() => Promise.resolve());
  const volumeCopy = mock(() => Promise.resolve());
  const composeUp = mock(() => Promise.resolve());
  const waitPg = mock(() => Promise.resolve());
  const mkdir = mock((path: string) => {
    dirs.add(path);
    return Promise.resolve(undefined);
  });
  const readText = mock((path: string) => {
    const value = files.get(path);
    if (value === undefined) {
      return Promise.reject(new Error(`ENOENT: ${path}`));
    }
    return Promise.resolve(value);
  });
  const writeText = mock((path: string, content: string) => {
    files.set(path, content);
    return Promise.resolve(undefined);
  });
  const readDir = mock((path: string) => {
    const prefix = `${path}/`;
    const entries = new Set<string>();
    for (const file of files.keys()) {
      if (file.startsWith(prefix)) {
        const rest = file.slice(prefix.length);
        if (rest && !rest.includes("/")) entries.add(rest);
      }
    }
    return Promise.resolve([...entries]);
  });
  const unlink = mock((path: string) => {
    files.delete(path);
    return Promise.resolve(undefined);
  });
  const rm = mock((path: string) => {
    files.delete(path);
    return Promise.resolve(undefined);
  });
  const pathExists = mock((path: string) => dirs.has(path) || files.has(path));
  const listBranches = mock(() => ["feat-123"]);
  const confirm = mock(() => Promise.resolve(true));

  return {
    deps: {
      readEnv,
      composeDown,
      volumeCreate,
      volumeRm,
      volumeCopy,
      composeUp,
      waitPg,
      mkdir,
      readText,
      writeText,
      readDir,
      unlink,
      rm,
      pathExists,
      listBranches,
      confirm,
    },
    files,
    dirs,
  };
}

describe("snapshot actions", () => {
  test("creates snapshot metadata and latest pointer", async () => {
    const { deps, files, dirs } = createSnapshotDeps();

    await snapshotAction("feat-123", "my-snapshot", deps as any);

    const snapshotDir = join(SNAPSHOTS_DIR, "feat-123");
    const snapshotFile = join(snapshotDir, "my-snapshot.json");

    expect(dirs.has(snapshotDir)).toBe(true);
    expect(deps.volumeCreate).toHaveBeenCalledWith("neurosteps_snapshot_feat-123_my-snapshot");
    expect(deps.volumeCopy).toHaveBeenCalledWith("myapp_db_feat-123", "neurosteps_snapshot_feat-123_my-snapshot");
    expect(files.get(join(snapshotDir, "latest"))).toBe("my-snapshot");

    const savedMeta = JSON.parse(files.get(snapshotFile)!);
    expect(savedMeta.name).toBe("my-snapshot");
    expect(savedMeta.volume).toBe("neurosteps_snapshot_feat-123_my-snapshot");
  });

  test("exits when branch not found", async () => {
    const { deps } = createSnapshotDeps();
    deps.readEnv = mock(() => Promise.resolve(null as any));

    const originalExit = process.exit;
    process.exit = ((code: number) => { throw new ProcessExit(String(code)); }) as any;

    try {
      await snapshotAction("NONEXISTENT", "test", deps as any);
      expect(false).toBe(true);
    } catch (e) {
      expect(e).toBeInstanceOf(ProcessExit);
    }

    process.exit = originalExit;
  });

  test("listSnapshotsAction reads snapshots from branch directory", async () => {
    const { deps, files, dirs } = createSnapshotDeps();
    const snapshotDir = join(SNAPSHOTS_DIR, "feat-123");
    dirs.add(snapshotDir);
    files.set(join(snapshotDir, "older.json"), JSON.stringify({
      name: "older",
      slug: "older",
      volume: "vol-older",
      created_at: "2026-05-07T10:00:00.000Z",
      source_branch: "feat-123",
      source_volume: "db-old",
    }));
    files.set(join(snapshotDir, "base.json"), JSON.stringify({
      name: "base",
      slug: "base",
      volume: "vol-base",
      created_at: "2026-05-07T11:00:00.000Z",
      source_branch: "feat-123",
      source_volume: "db-base",
    }));

    const consoleSpy = mock(() => {});
    const originalError = console.error;
    console.error = consoleSpy;

    await listSnapshotsAction("feat-123", deps as any);

    console.error = originalError;
    expect(consoleSpy.mock.calls.some((call: any) => String(call[0]).includes("Snapshots: feat-123"))).toBe(true);
    expect(consoleSpy.mock.calls.some((call: any) => String(call[0]).includes("feat-123:base:"))).toBe(true);
    expect(consoleSpy.mock.calls.some((call: any) => String(call[0]).includes("feat-123:older:"))).toBe(true);
  });

  test("restoreAction resolves latest and restores snapshot volume", async () => {
    const { deps, files, dirs } = createSnapshotDeps();
    const snapshotDir = join(SNAPSHOTS_DIR, "feat-123");
    dirs.add(snapshotDir);
    files.set(join(snapshotDir, "latest"), "base");
    files.set(join(snapshotDir, "base.json"), JSON.stringify({
      name: "base",
      slug: "base",
      volume: "snapshot-volume",
      created_at: "2026-05-07T11:00:00.000Z",
      source_branch: "feat-123",
      source_volume: "old-db-volume",
    }));

    await restoreAction("feat-123", "latest", true, deps as any);

    expect(deps.volumeRm).toHaveBeenCalledWith("myapp_db_feat-123");
    expect(deps.volumeCreate).toHaveBeenCalledWith("myapp_db_feat-123");
    expect(deps.volumeCopy).toHaveBeenCalledWith("snapshot-volume", "myapp_db_feat-123");
  });

  test("snapshotAction: rejects ':' in snapshot name", async () => {
    const { deps } = createSnapshotDeps();

    const originalExit = process.exit;
    process.exit = ((code: number) => { throw new ProcessExit(String(code)); }) as any;

    try {
      await snapshotAction("feat-123", "bad:name", deps as any);
      expect(false).toBe(true);
    } catch (e) {
      expect(e).toBeInstanceOf(ProcessExit);
    }

    process.exit = originalExit;
  });

  test("restoreAction: bare name without ':' uses same branch (retrocompat)", async () => {
    const { deps, files, dirs } = createSnapshotDeps();
    const snapshotDir = join(SNAPSHOTS_DIR, "feat-123");
    dirs.add(snapshotDir);
    files.set(join(snapshotDir, "snap1.json"), JSON.stringify({
      name: "snap1",
      slug: "snap1",
      volume: "snap-volume",
      created_at: "2026-05-07T11:00:00.000Z",
      source_branch: "feat-123",
      source_volume: "db-volume",
    }));

    await restoreAction("feat-123", "snap1", true, deps as any);

    expect(deps.volumeCopy).toHaveBeenCalledWith("snap-volume", "myapp_db_feat-123");
  });

  test("restoreAction: cross-branch restore uses origin branch for lookup, target for volume", async () => {
    const { deps, files, dirs } = createSnapshotDeps();
    const masterSnapshotDir = join(SNAPSHOTS_DIR, "master");
    dirs.add(masterSnapshotDir);
    files.set(join(masterSnapshotDir, "snap1.json"), JSON.stringify({
      name: "snap1",
      slug: "snap1",
      volume: "master-snapshot-volume",
      created_at: "2026-05-07T11:00:00.000Z",
      source_branch: "master",
      source_volume: "master-db-volume",
    }));

    await restoreAction("feat-123", "master:snap1", true, deps as any);

    expect(deps.volumeRm).toHaveBeenCalledWith("myapp_db_feat-123");
    expect(deps.volumeCreate).toHaveBeenCalledWith("myapp_db_feat-123");
    expect(deps.volumeCopy).toHaveBeenCalledWith("master-snapshot-volume", "myapp_db_feat-123");
  });

  test("restoreAction: master:latest resolves latest in origin branch", async () => {
    const { deps, files, dirs } = createSnapshotDeps();
    const masterSnapshotDir = join(SNAPSHOTS_DIR, "master");
    dirs.add(masterSnapshotDir);
    files.set(join(masterSnapshotDir, "latest"), "snap1");
    files.set(join(masterSnapshotDir, "snap1.json"), JSON.stringify({
      name: "snap1",
      slug: "snap1",
      volume: "master-snap-volume",
      created_at: "2026-05-07T11:00:00.000Z",
      source_branch: "master",
      source_volume: "master-db-volume",
    }));

    await restoreAction("feat-123", "master:latest", true, deps as any);

    expect(deps.volumeCopy).toHaveBeenCalledWith("master-snap-volume", "myapp_db_feat-123");
  });

  test("listSnapshotsAction --json includes ref field", async () => {
    const { deps, files, dirs } = createSnapshotDeps();
    const snapshotDir = join(SNAPSHOTS_DIR, "feat-123");
    dirs.add(snapshotDir);
    files.set(join(snapshotDir, "snap1.json"), JSON.stringify({
      name: "snap1",
      slug: "snap1",
      volume: "vol-snap1",
      created_at: "2026-05-07T11:00:00.000Z",
      source_branch: "feat-123",
      source_volume: "db-source",
    }));

    const output: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((s: string) => { output.push(s); return true; }) as any;

    await listSnapshotsAction("feat-123", deps as any, true);

    process.stdout.write = originalWrite;

    const parsed = JSON.parse(output.join(""));
    expect(parsed[0].ref).toBe("feat-123:snap1");
    expect(parsed[0].name).toBe("snap1");
  });

  test("removeBranchSnapshots removes all volumes and the snapshot directory", async () => {
    const { deps, files, dirs } = createSnapshotDeps();
    const snapshotDir = join(SNAPSHOTS_DIR, "feat-123");
    dirs.add(snapshotDir);
    files.set(join(snapshotDir, "snap1.json"), JSON.stringify({
      name: "snap1",
      slug: "snap1",
      volume: "vol-snap1",
      created_at: "2026-05-07T11:00:00.000Z",
      source_branch: "feat-123",
      source_volume: "db-source",
    }));
    files.set(join(snapshotDir, "snap2.json"), JSON.stringify({
      name: "snap2",
      slug: "snap2",
      volume: "vol-snap2",
      created_at: "2026-05-07T10:00:00.000Z",
      source_branch: "feat-123",
      source_volume: "db-source",
    }));

    await removeBranchSnapshots("feat-123", deps as any);

    expect(deps.volumeRm).toHaveBeenCalledWith("vol-snap1");
    expect(deps.volumeRm).toHaveBeenCalledWith("vol-snap2");
    expect(deps.rm).toHaveBeenCalledWith(snapshotDir, { recursive: true, force: true });
  });

  test("rmSnapshotAction removes snapshot and updates latest pointer", async () => {
    const { deps, files, dirs } = createSnapshotDeps();
    const snapshotDir = join(SNAPSHOTS_DIR, "feat-123");
    dirs.add(snapshotDir);
    files.set(join(snapshotDir, "latest"), "base");
    files.set(join(snapshotDir, "base.json"), JSON.stringify({
      name: "base",
      slug: "base",
      volume: "vol-base",
      created_at: "2026-05-07T11:00:00.000Z",
      source_branch: "feat-123",
      source_volume: "db-base",
    }));
    files.set(join(snapshotDir, "older.json"), JSON.stringify({
      name: "older",
      slug: "older",
      volume: "vol-older",
      created_at: "2026-05-07T10:00:00.000Z",
      source_branch: "feat-123",
      source_volume: "db-older",
    }));

    await rmSnapshotAction("feat-123", "latest", true, deps as any);

    expect(deps.volumeRm).toHaveBeenCalledWith("vol-base");
    expect(files.has(join(snapshotDir, "base.json"))).toBe(false);
    expect(files.get(join(snapshotDir, "latest"))).toBe("older");
  });
});
