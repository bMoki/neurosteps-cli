import { describe, expect, test } from "bun:test";
import {
  type CompactStatusRow,
  formatCompactBranchName,
  isCompactStatusRowFullyOff,
  sortCompactStatusRows,
} from "../../commands/status";

function row(overrides: Partial<CompactStatusRow>): CompactStatusRow {
  return {
    branch: "branch",
    dbRunning: false,
    backendRunning: false,
    frontendRunning: false,
    managerRunning: null,
    reportServerRunning: null,
    flags: [],
    stale: false,
    lastCommitAt: null,
    lastCliUsedAt: null,
    ...overrides,
  };
}

describe("status compact helpers", () => {
  test("truncates long branch names to the table width", () => {
    expect(formatCompactBranchName("feat-123")).toBe("feat-123      ");
    expect(formatCompactBranchName("feature-very-long-branch")).toBe("feature-ver...");
  });

  test("moves fully-off rows to the end", () => {
    const rows: CompactStatusRow[] = [
      row({
        branch: "inactive-no-manager",
      }),
      row({
        branch: "partial",
        backendRunning: true,
      }),
      row({
        branch: "active-manager",
        managerRunning: true,
      }),
      row({
        branch: "inactive-manager",
        managerRunning: false,
      }),
    ];

    expect(isCompactStatusRowFullyOff(rows[0]!)).toBe(true);
    expect(sortCompactStatusRows(rows).map((row) => row.branch)).toEqual([
      "partial",
      "active-manager",
      "inactive-no-manager",
      "inactive-manager",
    ]);
    expect(rows.map((row) => row.branch)[0]).toBe("inactive-no-manager");
  });
});
