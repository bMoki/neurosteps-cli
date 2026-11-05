import { afterEach, describe, expect, mock, test } from "bun:test";
import { listSnapshotsAction, restoreAction, rmSnapshotAction } from "../../commands/db";
import { createSnapshotDeps } from "../fixtures/snapshots";

const originalError = console.error;
const originalWrite = process.stdout.write.bind(process.stdout);

afterEach(() => {
  console.error = originalError;
  process.stdout.write = originalWrite;
});

function captureStderr(): string[] {
  const lines: string[] = [];
  console.error = mock((line: unknown) => { lines.push(String(line)); });
  return lines;
}

describe("ns db restore", () => {
  test("pergunta com a origem antes de restaurar de outra branch", async () => {
    const { deps, addSnapshot } = createSnapshotDeps();
    addSnapshot("master", "seed");
    const confirm = mock(() => Promise.resolve(true));
    captureStderr();

    await restoreAction("feat-123", "master:seed", false, { ...deps, confirm });

    expect((confirm.mock.calls[0] as any)[0]).toBe("Restaurar 'master:seed' (origem: master) em 'feat-123'? Isso substituirá o banco atual.");
    expect(deps.volumeCopy).toHaveBeenCalledWith("vol-master-seed", "myapp_db_feat-123");
  });

  test("resposta não cancela sem mexer no banco", async () => {
    const { deps, addSnapshot } = createSnapshotDeps();
    addSnapshot("feat-123", "base");
    captureStderr();

    await restoreAction("feat-123", "base", false, { ...deps, confirm: mock(() => Promise.resolve(false)) });

    expect(deps.composeDown).not.toHaveBeenCalled();
  });

  test("--dry-run só descreve", async () => {
    const { deps, addSnapshot } = createSnapshotDeps();
    addSnapshot("feat-123", "base");
    const lines = captureStderr();

    await restoreAction("feat-123", "base", false, deps, true);

    expect(lines.some((line) => line.includes("substituir volume myapp_db_feat-123 pelo snapshot 'base'"))).toBe(true);
    expect(deps.composeDown).not.toHaveBeenCalled();
  });
});

describe("ns db snapshots", () => {
  test("lista por branch com a referência completa", async () => {
    const { deps, addSnapshot } = createSnapshotDeps();
    addSnapshot("feat-123", "base");
    const lines = captureStderr();

    await listSnapshotsAction("feat-123", deps);

    expect(lines.some((line) => line.includes("Snapshots: feat-123"))).toBe(true);
    expect(lines.some((line) => line.includes("feat-123:base:"))).toBe(true);
  });

  test("--json da branch mantém o formato", async () => {
    const { deps, addSnapshot } = createSnapshotDeps();
    addSnapshot("feat-123", "snap1");
    const output: string[] = [];
    process.stdout.write = ((chunk: string) => { output.push(chunk); return true; }) as any;

    await listSnapshotsAction("feat-123", deps, true);

    expect(JSON.parse(output.join(""))).toEqual([
      { name: "snap1", ref: "feat-123:snap1", created_at: "2026-05-07T11:00:00.000Z", volume: "vol-feat-123-snap1" },
    ]);
  });
});

describe("ns db rm-snapshot", () => {
  test("pede confirmação antes de remover", async () => {
    const { deps, addSnapshot } = createSnapshotDeps();
    addSnapshot("feat-123", "base");
    const confirm = mock(() => Promise.resolve(false));
    captureStderr();

    await rmSnapshotAction("feat-123", "base", false, { ...deps, confirm });

    expect((confirm.mock.calls[0] as any)[0]).toBe("Remover snapshot 'base' de feat-123?");
    expect(deps.volumeRm).not.toHaveBeenCalled();
  });
});
