import { describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { ensureWorkspaceBootstrap } from "../../lib/bootstrap";

describe("workspace bootstrap", () => {
  test("creates base directories and bundled templates", async () => {
    const root = mkdtempSync(join(tmpdir(), "ns-bootstrap-"));
    const workspaceDir = join(root, "myapp-workspace");
    const templatesDir = join(workspaceDir, "templates");

    try {
      const result = await ensureWorkspaceBootstrap({
        workspaceDir,
        templatesDir,
        snapshotsDir: join(workspaceDir, "snapshots"),
        configDir: join(workspaceDir, "config"),
        worktreesDir: join(root, "worktrees"),
      });

      expect(result.createdDirs.length).toBeGreaterThan(0);
      expect(result.installedTemplates).toContain("workspace.env");
      expect(await Bun.file(join(templatesDir, "workspace.env")).text()).toContain("BRANCH_NAME");
      expect(await Bun.file(join(templatesDir, "frontend-.env.local")).text()).toContain("REACT_APP_PORTLESS_PROXY_PORT");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("preserves local templates on subsequent runs", async () => {
    const root = mkdtempSync(join(tmpdir(), "ns-bootstrap-"));
    const workspaceDir = join(root, "myapp-workspace");
    const templatesDir = join(workspaceDir, "templates");
    const frontendEnv = join(templatesDir, "frontend-.env.local");

    try {
      await ensureWorkspaceBootstrap({
        workspaceDir,
        templatesDir,
        snapshotsDir: join(workspaceDir, "snapshots"),
        configDir: join(workspaceDir, "config"),
        worktreesDir: join(root, "worktrees"),
      });

      writeFileSync(frontendEnv, "CUSTOM=true\n");

      const result = await ensureWorkspaceBootstrap({
        workspaceDir,
        templatesDir,
        snapshotsDir: join(workspaceDir, "snapshots"),
        configDir: join(workspaceDir, "config"),
        worktreesDir: join(root, "worktrees"),
      });

      expect(result.preservedTemplates).toContain("frontend-.env.local");
      expect(await Bun.file(frontendEnv).text()).toBe("CUSTOM=true\n");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
