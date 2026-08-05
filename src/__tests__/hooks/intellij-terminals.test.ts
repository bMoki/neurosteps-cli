import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  configureIntellijTerminals,
  generateJetBrainsProjectId,
  upsertTerminalTabsStorage,
} from "../../hooks/intellij-terminals";

describe("configureIntellijTerminals", () => {
  test("writes terminal tabs for each repo", async () => {
    const root = mkdtempSync(join(tmpdir(), "ns-intellij-terminals-"));
    const ideaDir = join(root, ".idea");

    try {
      await configureIntellijTerminals({
        ideaDir,
        projectId: "project-1",
        jetbrainsConfigDir: null,
        repos: [
          { name: "backend", path: "backend" },
          { name: "frontend", path: "frontend" },
          { name: "docs", path: "docs" },
          { name: "manager", path: "manager" },
        ],
      });

      const workspace = await Bun.file(join(ideaDir, "workspace.xml")).text();

      expect(workspace).toContain('<component name="ProjectId" id="project-1" />');
      expect(workspace).toContain('<component name="TerminalTabsStorage">');
      expect(workspace).toContain('name="backend" isUserDefinedName="true" workingDirectory="$PROJECT_DIR$/backend" processType="SHELL"');
      expect(workspace).toContain('name="frontend" isUserDefinedName="true" workingDirectory="$PROJECT_DIR$/frontend" processType="SHELL"');
      expect(workspace).toContain('name="docs" isUserDefinedName="true" workingDirectory="$PROJECT_DIR$/docs" processType="SHELL"');
      expect(workspace).toContain('name="manager" isUserDefinedName="true" workingDirectory="$PROJECT_DIR$/manager" processType="SHELL"');
      expect(workspace).not.toContain("shellCommand");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("writes JetBrains global workspace tabs using project id", async () => {
    const root = mkdtempSync(join(tmpdir(), "ns-intellij-terminals-"));
    const ideaDir = join(root, ".idea");
    const jetbrainsConfigDir = join(root, "JetBrains", "IntelliJIdea2026.2");

    try {
      await configureIntellijTerminals({
        ideaDir,
        projectId: "project-global-1",
        jetbrainsConfigDir,
        repos: [
          { name: "backend", path: "backend" },
          { name: "frontend", path: "frontend" },
        ],
      });

      const projectWorkspace = await Bun.file(join(ideaDir, "workspace.xml")).text();
      const globalWorkspace = await Bun.file(join(jetbrainsConfigDir, "workspace", "project-global-1.xml")).text();

      expect(projectWorkspace).toContain('<component name="ProjectId" id="project-global-1" />');
      expect(globalWorkspace).toContain('<component name="ProjectRoots">');
      expect(globalWorkspace).toContain('<component name="TerminalTabsStorage">');
      expect(globalWorkspace).toContain('name="backend" isUserDefinedName="true" workingDirectory="$PROJECT_DIR$/backend" processType="SHELL"');
      expect(globalWorkspace).toContain('name="frontend" isUserDefinedName="true" workingDirectory="$PROJECT_DIR$/frontend" processType="SHELL"');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("writes JetBrains global workspace tabs to multiple IntelliJ config dirs", async () => {
    const root = mkdtempSync(join(tmpdir(), "ns-intellij-terminals-"));
    const ideaDir = join(root, ".idea");
    const configDirs = [
      join(root, "JetBrains", "IntelliJIdea2026.1"),
      join(root, "JetBrains", "IntelliJIdea2026.2"),
    ];

    try {
      await configureIntellijTerminals({
        ideaDir,
        projectId: "project-global-all",
        jetbrainsConfigDir: configDirs,
        repos: [{ name: "backend", path: "backend" }],
      });

      for (const configDir of configDirs) {
        const globalWorkspace = await Bun.file(join(configDir, "workspace", "project-global-all.xml")).text();
        expect(globalWorkspace).toContain('name="backend" isUserDefinedName="true" workingDirectory="$PROJECT_DIR$/backend" processType="SHELL"');
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("generates JetBrains-shaped project ids", () => {
    expect(generateJetBrainsProjectId()).toMatch(/^3[0-9A-Za-z]{26}$/);
  });

  test("reuses existing project id", async () => {
    const root = mkdtempSync(join(tmpdir(), "ns-intellij-terminals-"));
    const ideaDir = join(root, ".idea");
    const jetbrainsConfigDir = join(root, "JetBrains", "IntelliJIdea2026.2");

    try {
      mkdirSync(ideaDir, { recursive: true });
      await Bun.write(join(ideaDir, "workspace.xml"), `<?xml version="1.0" encoding="UTF-8"?>
<project version="4">
  <component name="ProjectId" id="existing-project" />
</project>
`);

      await configureIntellijTerminals({
        ideaDir,
        jetbrainsConfigDir,
        repos: [{ name: "backend", path: "backend" }],
      });

      const globalWorkspace = await Bun.file(join(jetbrainsConfigDir, "workspace", "existing-project.xml")).text();
      expect(globalWorkspace).toContain('name="backend"');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("replaces existing terminal component without removing Maven settings", () => {
    const workspace = `<?xml version="1.0" encoding="UTF-8"?>
<project version="4">
  <component name="MavenProjectsManager">
    <option name="originalFiles" />
  </component>
  <component name="TerminalTabsStorage">
    <option name="tabs">
      <TerminalSessionPersistedTab name="old" workingDirectory="$PROJECT_DIR$" processType="SHELL" />
    </option>
  </component>
</project>
`;

    const result = upsertTerminalTabsStorage(workspace, [
      { name: "backend", path: "backend" },
      { name: "frontend", path: "frontend" },
    ]);

    expect(result).toContain('<component name="MavenProjectsManager">');
    expect(result).toContain('name="backend" isUserDefinedName="true" workingDirectory="$PROJECT_DIR$/backend" processType="SHELL"');
    expect(result).toContain('name="frontend" isUserDefinedName="true" workingDirectory="$PROJECT_DIR$/frontend" processType="SHELL"');
    expect(result).not.toContain('name="old"');
  });

  test("escapes XML values", () => {
    const result = upsertTerminalTabsStorage("<project version=\"4\">\n</project>\n", [
      { name: "front&end", path: "front<end>" },
    ]);

    expect(result).toContain('name="front&amp;end"');
    expect(result).toContain('workingDirectory="$PROJECT_DIR$/front&lt;end&gt;"');
  });
});
