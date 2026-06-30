import { describe, expect, test } from "bun:test";
import {
  type CompactStatusRow,
  formatCompactBranchName,
  isCompactStatusRowFullyOff,
  sortCompactStatusRows,
} from "../../commands/status";

describe("status compact helpers", () => {
  test("truncates long branch names to the table width", () => {
    expect(formatCompactBranchName("feat-123")).toBe("feat-123      ");
    expect(formatCompactBranchName("feature-very-long-branch")).toBe("feature-ver...");
  });

  test("moves fully-off rows to the end", () => {
    const rows: CompactStatusRow[] = [
      {
        branch: "inactive-no-manager",
        dbRunning: false,
        backendRunning: false,
        frontendRunning: false,
        managerRunning: null,
        reportServerRunning: null,
      },
      {
        branch: "partial",
        dbRunning: false,
        backendRunning: true,
        frontendRunning: false,
        managerRunning: null,
        reportServerRunning: null,
      },
      {
        branch: "active-manager",
        dbRunning: false,
        backendRunning: false,
        frontendRunning: false,
        managerRunning: true,
        reportServerRunning: null,
      },
      {
        branch: "inactive-manager",
        dbRunning: false,
        backendRunning: false,
        frontendRunning: false,
        managerRunning: false,
        reportServerRunning: null,
      },
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
