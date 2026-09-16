import { describe, expect, test } from "bun:test";
import {
  getBranchFlags,
  getBranchFlagsMany,
  isBranchStale,
  listFlaggedBranches,
} from "../../lib/branch-flags";

// Nomes que não existem no workspace: nenhum git é disparado, o resultado é determinístico.
const MISSING = (n: number) => Array.from({ length: n }, (_, i) => `__sem-worktree-${i}__`);

describe("branch flags", () => {
  const now = new Date("2026-06-30T12:00:00.000Z");

  test("marks branch stale when last commit and CLI usage are older than seven days", () => {
    expect(isBranchStale({
      lastCommitAt: new Date("2026-06-20T12:00:00.000Z"),
      lastCliUsedAt: new Date("2026-06-21T12:00:00.000Z"),
    }, now)).toBe(true);
  });

  test("does not mark branch stale when last commit is recent", () => {
    expect(isBranchStale({
      lastCommitAt: new Date("2026-06-29T12:00:00.000Z"),
      lastCliUsedAt: null,
    }, now)).toBe(false);
  });

  test("does not mark branch stale when CLI usage is recent", () => {
    expect(isBranchStale({
      lastCommitAt: new Date("2026-06-01T12:00:00.000Z"),
      lastCliUsedAt: new Date("2026-06-29T12:00:00.000Z"),
    }, now)).toBe(false);
  });

  test("does not mark branch stale when commit date cannot be determined", () => {
    expect(isBranchStale({
      lastCommitAt: null,
      lastCliUsedAt: new Date("2026-06-01T12:00:00.000Z"),
    }, now)).toBe(false);
  });
});

describe("leitura em lote", () => {
  test("devolve uma entrada por branch pedida", async () => {
    const branches = MISSING(3);
    const infos = await getBranchFlagsMany(branches);

    expect([...infos.keys()]).toEqual(branches);
    expect(infos.get(branches[0]!)).toEqual({
      flags: [],
      stale: false,
      lastCommitAt: null,
      lastCliUsedAt: null,
    });
  });

  test("lista vazia não quebra o pool de workers", async () => {
    expect(await getBranchFlagsMany([])).toEqual(new Map());
  });

  test("mantém a correspondência branch→resultado acima do limite de concorrência", async () => {
    const branches = MISSING(20);
    const infos = await getBranchFlagsMany(branches);

    expect(infos.size).toBe(20);
    expect(branches.every((branch) => infos.has(branch))).toBe(true);
  });

  test("getBranchFlags devolve a mesma forma da leitura em lote", async () => {
    const [branch] = MISSING(1);
    const single = await getBranchFlags(branch!);

    expect(single).toEqual((await getBranchFlagsMany([branch!])).get(branch!)!);
  });

  test("listFlaggedBranches ignora branches sem a flag", async () => {
    expect(await listFlaggedBranches(MISSING(3))).toEqual([]);
  });
});
