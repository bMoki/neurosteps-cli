import { describe, expect, test } from "bun:test";
import { tmpdir } from "os";
import {
  BACKEND_REPO,
  BASE_DIR,
  DOCS_REPO,
  FRONTEND_REPO,
  MANAGER_REPO,
  PARENTS_REPO,
  REPORT_SERVER_REPO,
  SNAPSHOTS_DIR,
  TEMPLATES_DIR,
  WORKTREES_DIR,
} from "../../lib/env";
import { NS_CONFIG_DIR } from "../../lib/settings";

describe("test isolation", () => {
  test("config and workspace paths point into the suite's temp folder", () => {
    for (const path of [
      NS_CONFIG_DIR, BASE_DIR, WORKTREES_DIR, TEMPLATES_DIR, SNAPSHOTS_DIR,
      BACKEND_REPO, FRONTEND_REPO, MANAGER_REPO, REPORT_SERVER_REPO, DOCS_REPO, PARENTS_REPO,
    ]) {
      expect(path.startsWith(tmpdir())).toBe(true);
    }
  });
});
