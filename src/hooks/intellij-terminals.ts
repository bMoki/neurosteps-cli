import { existsSync, mkdirSync, readdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export interface IntellijTerminalRepo {
  name: string;
  path: string;
}

export interface ConfigureIntellijTerminalsInput {
  ideaDir: string;
  repos: IntellijTerminalRepo[];
  projectId?: string;
  jetbrainsConfigDir?: string | string[] | null;
}

const PROJECT_ID_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function xml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function configureIntellijTerminals(input: ConfigureIntellijTerminalsInput): Promise<void> {
  mkdirSync(input.ideaDir, { recursive: true });

  const workspacePath = join(input.ideaDir, "workspace.xml");
  const file = Bun.file(workspacePath);
  const workspace = await file.exists()
    ? await file.text()
    : `<?xml version="1.0" encoding="UTF-8"?>\n<project version="4">\n</project>\n`;
  const projectId = input.projectId ?? extractProjectId(workspace) ?? generateJetBrainsProjectId();

  const projectWorkspace = upsertTerminalTabsStorage(upsertProjectId(workspace, projectId), input.repos);
  await Bun.write(workspacePath, projectWorkspace);

  const jetbrainsConfigDirs = input.jetbrainsConfigDir === undefined
    ? resolveIntellijConfigDirs()
    : normalizeConfigDirs(input.jetbrainsConfigDir);
  for (const jetbrainsConfigDir of jetbrainsConfigDirs) {
    await writeJetBrainsWorkspace(jetbrainsConfigDir, projectId, input.repos);
  }
}

async function writeJetBrainsWorkspace(
  jetbrainsConfigDir: string,
  projectId: string,
  repos: IntellijTerminalRepo[],
): Promise<void> {
  const jetbrainsWorkspaceDir = join(jetbrainsConfigDir, "workspace");
  mkdirSync(jetbrainsWorkspaceDir, { recursive: true });
  const jetbrainsWorkspacePath = join(jetbrainsWorkspaceDir, `${projectId}.xml`);
  const jetbrainsFile = Bun.file(jetbrainsWorkspacePath);
  const jetbrainsWorkspace = await jetbrainsFile.exists()
    ? await jetbrainsFile.text()
    : `<?xml version="1.0" encoding="UTF-8"?>\n<project version="4">\n  <component name="ProjectRoots">\n    <project-root url="file://$PROJECT_DIR$" />\n  </component>\n</project>\n`;

  await Bun.write(jetbrainsWorkspacePath, upsertTerminalTabsStorage(jetbrainsWorkspace, repos));
}

function normalizeConfigDirs(input: string | string[] | null): string[] {
  if (input === null) return [];
  return Array.isArray(input) ? input : [input];
}

export function generateJetBrainsProjectId(): string {
  const bytes = new Uint8Array(26);
  crypto.getRandomValues(bytes);

  let id = "3";
  for (const byte of bytes) {
    id += PROJECT_ID_CHARS[byte % PROJECT_ID_CHARS.length];
  }

  return id;
}

export function extractProjectId(workspaceXml: string): string | null {
  return workspaceXml.match(/<component name="ProjectId" id="([^"]+)"\s*\/>/)?.[1] ?? null;
}

export function upsertProjectId(workspaceXml: string, projectId: string): string {
  const component = `  <component name="ProjectId" id="${xml(projectId)}" />`;
  const existingComponent = /\n?\s*<component name="ProjectId" id="[^"]+"\s*\/>/;

  if (existingComponent.test(workspaceXml)) {
    return workspaceXml.replace(existingComponent, `\n${component}`);
  }

  if (workspaceXml.includes("</project>")) {
    return workspaceXml.replace(/\n?\s*<\/project>\s*$/, `\n${component}\n</project>\n`);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>\n<project version="4">\n${component}\n</project>\n`;
}

export function upsertTerminalTabsStorage(workspaceXml: string, repos: IntellijTerminalRepo[]): string {
  const component = terminalTabsStorageXml(repos);
  const existingComponent = /\n?\s*<component name="TerminalTabsStorage">[\s\S]*?<\/component>/;

  if (existingComponent.test(workspaceXml)) {
    return workspaceXml.replace(existingComponent, `\n${component}`);
  }

  if (workspaceXml.includes("</project>")) {
    return workspaceXml.replace(/\n?\s*<\/project>\s*$/, `\n${component}\n</project>\n`);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>\n<project version="4">\n${component}\n</project>\n`;
}

function terminalTabsStorageXml(repos: IntellijTerminalRepo[]): string {
  const tabs = repos.map((repo) => `      <TerminalSessionPersistedTab name="${xml(repo.name)}" isUserDefinedName="true" workingDirectory="$PROJECT_DIR$/${xml(repo.path)}" processType="SHELL">
        <option name="envVariables">
          <map />
        </option>
      </TerminalSessionPersistedTab>`).join("\n");

  return `  <component name="TerminalTabsStorage">
    <option name="tabs">
${tabs}
    </option>
  </component>`;
}

function resolveIntellijConfigDirs(): string[] {
  const jetbrainsDir = join(homedir(), "Library", "Application Support", "JetBrains");
  if (!existsSync(jetbrainsDir)) return [];

  return readdirSync(jetbrainsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^IntelliJIdea\d/.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => b.localeCompare(a))
    .map((name) => join(jetbrainsDir, name));
}
