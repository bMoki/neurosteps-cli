import { describe, expect, mock, test } from "bun:test";
import { join } from "path";
import {
  NsError,
  type NsErrorCategory,
  createSilentContext,
  runDbRestore,
  runDbRestorePreview,
  runDbRmSnapshot,
  runDbSnapshot,
  runDbSnapshots,
} from "../../core";
import { removeBranchSnapshots } from "../../core/operations/snapshot";
import { SNAPSHOTS_DIR } from "../../lib/config";
import { createSnapshotDeps } from "../fixtures/snapshots";

const silent = createSilentContext();

async function expectCategory(run: Promise<unknown>, category: NsErrorCategory) {
  await run.catch((error: NsError) => expect(error.category).toBe(category));
  await expect(run).rejects.toBeInstanceOf(NsError);
}

describe("runDbSnapshot", () => {
  test("copia o banco para um volume de Snapshot e aponta latest para ele", async () => {
    const { deps, files, dirs } = createSnapshotDeps();
    const snapshotDir = join(SNAPSHOTS_DIR, "feat-123");

    const snapshot = await runDbSnapshot({ branch: "feat-123", name: "my-snapshot" }, silent, deps);

    expect(snapshot).toMatchObject({ branch: "feat-123", name: "my-snapshot", ref: "feat-123:my-snapshot", volume: "neurosteps_snapshot_feat-123_my-snapshot" });
    expect(dirs.has(snapshotDir)).toBe(true);
    expect(deps.volumeCopy).toHaveBeenCalledWith("myapp_db_feat-123", "neurosteps_snapshot_feat-123_my-snapshot");
    expect(files.get(join(snapshotDir, "latest"))).toBe("my-snapshot");
    expect(JSON.parse(files.get(join(snapshotDir, "my-snapshot.json"))!)).toMatchObject({ name: "my-snapshot", volume: snapshot.volume });
    expect(deps.composeUp).toHaveBeenCalled();
  });

  test("avisa cada passo pelo contexto", async () => {
    const { deps } = createSnapshotDeps();
    const emit = mock(() => {});

    await runDbSnapshot({ branch: "feat-123", name: "s" }, { ...silent, emit }, deps);

    expect(emit.mock.calls.map((call: any) => call[0].step)).toEqual(["db:stop", "snapshot:copy", "db:start"]);
  });

  test("branch inexistente é nao-encontrado", async () => {
    const { deps } = createSnapshotDeps();
    deps.readEnv = mock(() => Promise.resolve(null));

    await expectCategory(runDbSnapshot({ branch: "sumiu", name: "s" }, silent, deps), "nao-encontrado");
    expect(deps.composeDown).not.toHaveBeenCalled();
  });

  test.each(["bad:name", "a/b", "latest"])("nome '%s' é recusado antes de parar o banco", async (name) => {
    const { deps } = createSnapshotDeps();

    await expectCategory(runDbSnapshot({ branch: "feat-123", name }, silent, deps), "pre-condicao");
    expect(deps.composeDown).not.toHaveBeenCalled();
  });

  test("falha do docker vira ferramenta-externa, e o banco sobe de novo", async () => {
    const { deps } = createSnapshotDeps();
    deps.volumeCopy = mock(() => Promise.reject(new Error("docker: no space left")));

    await expectCategory(runDbSnapshot({ branch: "feat-123", name: "s" }, silent, deps), "ferramenta-externa");
    expect(deps.composeUp).toHaveBeenCalled();
  });
});

describe("runDbSnapshots", () => {
  test("lista os Snapshots da branch do mais novo para o mais antigo", async () => {
    const { deps, addSnapshot } = createSnapshotDeps();
    addSnapshot("feat-123", "older", "2026-05-07T10:00:00.000Z");
    addSnapshot("feat-123", "base", "2026-05-07T11:00:00.000Z");

    const groups = await runDbSnapshots({ branch: "feat-123" }, silent, deps);

    expect(groups).toEqual([{ branch: "feat-123", snapshots: [
      { branch: "feat-123", name: "base", ref: "feat-123:base", createdAt: "2026-05-07T11:00:00.000Z", volume: "vol-feat-123-base" },
      { branch: "feat-123", name: "older", ref: "feat-123:older", createdAt: "2026-05-07T10:00:00.000Z", volume: "vol-feat-123-older" },
    ] }]);
  });

  test("sem branch, agrupa por branch de origem as branches com pasta de Snapshots", async () => {
    const { deps, dirs, addSnapshot } = createSnapshotDeps();
    deps.listBranches = mock(() => ["feat-123", "master", "vazia", "sem-pasta"]);
    addSnapshot("feat-123", "a");
    addSnapshot("master", "seed");
    dirs.add(join(SNAPSHOTS_DIR, "vazia"));

    const groups = await runDbSnapshots({}, silent, deps);

    expect(groups.map(({ branch, snapshots }) => [branch, snapshots.map(({ ref }) => ref)])).toEqual([
      ["feat-123", ["feat-123:a"]],
      ["master", ["master:seed"]],
      ["vazia", []],
    ]);
  });
});

describe("runDbRestore", () => {
  test("restaura um Snapshot da própria branch", async () => {
    const { deps, addSnapshot } = createSnapshotDeps();
    addSnapshot("feat-123", "snap1", undefined, "snap-volume");

    const result = await runDbRestore({ branch: "feat-123", ref: "snap1" }, silent, deps);

    expect(result.snapshot.ref).toBe("feat-123:snap1");
    expect(deps.volumeRm).toHaveBeenCalledWith("myapp_db_feat-123");
    expect(deps.volumeCreate).toHaveBeenCalledWith("myapp_db_feat-123");
    expect(deps.volumeCopy).toHaveBeenCalledWith("snap-volume", "myapp_db_feat-123");
  });

  test("restaura um Snapshot de outra branch no banco da branch alvo", async () => {
    const { deps, addSnapshot } = createSnapshotDeps();
    addSnapshot("master", "snap1", undefined, "master-snapshot-volume");

    const result = await runDbRestore({ branch: "feat-123", ref: "master:snap1" }, silent, deps);

    expect(result).toMatchObject({ branch: "feat-123", volume: "myapp_db_feat-123", snapshot: { branch: "master", ref: "master:snap1" } });
    expect(deps.volumeCopy).toHaveBeenCalledWith("master-snapshot-volume", "myapp_db_feat-123");
  });

  test("latest resolve o mais recente da branch de origem", async () => {
    const { deps, files, addSnapshot } = createSnapshotDeps();
    const dir = addSnapshot("master", "snap1", undefined, "master-snap-volume");
    files.set(join(dir, "latest"), "snap1");

    await runDbRestore({ branch: "feat-123", ref: "master:latest" }, silent, deps);

    expect(deps.volumeCopy).toHaveBeenCalledWith("master-snap-volume", "myapp_db_feat-123");
  });

  test("Snapshot inexistente é nao-encontrado e não mexe no banco", async () => {
    const { deps } = createSnapshotDeps();

    await expectCategory(runDbRestore({ branch: "feat-123", ref: "master:sumiu" }, silent, deps), "nao-encontrado");
    expect(deps.composeDown).not.toHaveBeenCalled();
  });

  test("falha no meio da troca de volume ainda sobe o banco", async () => {
    const { deps, addSnapshot } = createSnapshotDeps();
    addSnapshot("master", "seed");
    deps.volumeCopy = mock(() => Promise.reject(new Error("docker: volume in use")));

    await expectCategory(runDbRestore({ branch: "feat-123", ref: "master:seed" }, silent, deps), "ferramenta-externa");
    expect(deps.composeUp).toHaveBeenCalled();
  });

  test("metadados corrompidos são pre-condicao", async () => {
    const { deps, files, addSnapshot } = createSnapshotDeps();
    const dir = addSnapshot("master", "seed");
    files.set(join(dir, "seed.json"), "{ quebrado");

    await expectCategory(runDbRestore({ branch: "feat-123", ref: "master:seed" }, silent, deps), "pre-condicao");
    expect(deps.composeDown).not.toHaveBeenCalled();
  });

  test("a prévia resolve a referência sem mexer no banco", async () => {
    const { deps, addSnapshot } = createSnapshotDeps();
    addSnapshot("master", "seed");

    const preview = await runDbRestorePreview({ branch: "feat-123", ref: "master:seed" }, silent, deps);

    expect(preview).toMatchObject({ branch: "feat-123", volume: "myapp_db_feat-123", snapshot: { ref: "master:seed" } });
    expect(deps.composeDown).not.toHaveBeenCalled();
  });
});

describe("runDbRmSnapshot", () => {
  test("remove o Snapshot e aponta latest para o mais novo que sobrou", async () => {
    const { deps, files, addSnapshot } = createSnapshotDeps();
    const dir = addSnapshot("feat-123", "base", "2026-05-07T11:00:00.000Z", "vol-base");
    addSnapshot("feat-123", "older", "2026-05-07T10:00:00.000Z");
    files.set(join(dir, "latest"), "base");

    const removed = await runDbRmSnapshot({ branch: "feat-123", name: "latest" }, silent, deps);

    expect(removed.name).toBe("base");
    expect(deps.volumeRm).toHaveBeenCalledWith("vol-base");
    expect(files.has(join(dir, "base.json"))).toBe(false);
    expect(files.get(join(dir, "latest"))).toBe("older");
  });

  test("sem Snapshots sobrando, apaga o latest", async () => {
    const { deps, files, addSnapshot } = createSnapshotDeps();
    const dir = addSnapshot("feat-123", "only");
    files.set(join(dir, "latest"), "only");

    await runDbRmSnapshot({ branch: "feat-123", name: "only" }, silent, deps);

    expect(files.has(join(dir, "latest"))).toBe(false);
  });
});

describe("removeBranchSnapshots", () => {
  test("remove todos os volumes e a pasta de Snapshots da branch", async () => {
    const { deps, addSnapshot } = createSnapshotDeps();
    const dir = addSnapshot("feat-123", "snap1", undefined, "vol-snap1");
    addSnapshot("feat-123", "snap2", "2026-05-07T10:00:00.000Z", "vol-snap2");

    await removeBranchSnapshots("feat-123", deps);

    expect(deps.volumeRm).toHaveBeenCalledWith("vol-snap1");
    expect(deps.volumeRm).toHaveBeenCalledWith("vol-snap2");
    expect(deps.rm).toHaveBeenCalledWith(dir, { recursive: true, force: true });
  });
});
