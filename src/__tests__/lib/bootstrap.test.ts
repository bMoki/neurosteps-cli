import { describe, test, expect } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
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
      const workspaceEnv = await Bun.file(join(templatesDir, "workspace.env")).text();
      expect(workspaceEnv).toContain("BRANCH_NAME");
      expect(workspaceEnv).toContain("DB_NAME");
      const frontendEnv = await Bun.file(join(templatesDir, "frontend-.env.local")).text();
      const managerEnv = await Bun.file(join(templatesDir, "manager-.env.local")).text();
      const backendProps = await Bun.file(join(templatesDir, "backend-application-dev.properties")).text();
      expect(frontendEnv).toContain("REACT_APP_PORTLESS_PROXY_PORT");
      expect(frontendEnv).toContain("REACT_APP_API_URL=https://");
      expect(managerEnv).toContain("VITE_API_URL=https://");
      expect(backendProps).toContain("%dev.neurosteps.frontend.url=https://");
      expect(backendProps).toContain("{{DB_NAME}}");
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

  test("updates legacy bundled templates", async () => {
    const root = mkdtempSync(join(tmpdir(), "ns-bootstrap-"));
    const workspaceDir = join(root, "myapp-workspace");
    const templatesDir = join(workspaceDir, "templates");
    const backendProps = join(templatesDir, "backend-application-dev.properties");

    try {
      mkdirSync(templatesDir, { recursive: true });
      writeFileSync(backendProps, `quarkus.http.port={{BACKEND_PORT}}
quarkus.datasource.jdbc.url=jdbc:postgresql://localhost:{{DB_PORT}}/app_database
quarkus.datasource.username=postgres
quarkus.datasource.password=docker
workspace.branch.name={{BRANCH_NAME}}
%dev.neurosteps.frontend.url=https://{{BRANCH_SLUG}}.web.{{PRODUCT_NAME}}.localhost:{{PORTLESS_PROXY_PORT}}
`);

      const result = await ensureWorkspaceBootstrap({
        workspaceDir,
        templatesDir,
        snapshotsDir: join(workspaceDir, "snapshots"),
        configDir: join(workspaceDir, "config"),
        worktreesDir: join(root, "worktrees"),
      });

      expect(result.updatedTemplates).toContain("backend-application-dev.properties");
      expect(await Bun.file(backendProps).text()).toContain("{{DB_NAME}}");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
