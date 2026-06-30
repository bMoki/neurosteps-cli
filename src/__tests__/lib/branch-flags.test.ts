import { describe, expect, test } from "bun:test";
import { isBranchStale } from "../../lib/branch-flags";

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
