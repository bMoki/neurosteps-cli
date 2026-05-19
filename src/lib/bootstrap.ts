import { mkdirSync, existsSync } from "fs";
import { dirname, join } from "path";
import {
  TEMPLATES_DIR,
  WORKSPACE_DIR,
  WORKTREES_DIR,
} from "./config";

interface TemplateSpec {
  content: string;
  optional?: boolean;
}

const BUNDLED_TEMPLATES: Record<string, TemplateSpec> = {
  "workspace.env": {
    content: `BRANCH_NAME="{{BRANCH_NAME}}"
BRANCH_SLUG="{{BRANCH_SLUG}}"
DB_PORT="{{DB_PORT}}"
BACKEND_PORT="{{BACKEND_PORT}}"
BACKEND_DEBUG_PORT="{{BACKEND_DEBUG_PORT}}"
FRONTEND_PORT="{{FRONTEND_PORT}}"
MANAGER_PORT="{{MANAGER_PORT}}"
DB_VOLUME="{{DB_VOLUME}}"
DB_CONTAINER="{{DB_CONTAINER}}"
DB_USER="{{DB_USER}}"
DB_PASSWORD="{{DB_PASSWORD}}"
DB_NAME="{{DB_NAME}}"
COMPOSE_PROJECT="{{COMPOSE_PROJECT}}"
CREATED_AT="{{CREATED_AT}}"
SEEDED_FROM="{{SEEDED_FROM}}"
`,
  },
  "backend-application-dev.properties": {
    content: `quarkus.http.port={{BACKEND_PORT}}
quarkus.datasource.jdbc.url=jdbc:postgresql://localhost:{{DB_PORT}}/{{DB_NAME}}
quarkus.datasource.username={{DB_USER}}
quarkus.datasource.password={{DB_PASSWORD}}
workspace.branch.name={{BRANCH_NAME}}
%dev.neurosteps.frontend.url=https://{{BRANCH_SLUG}}.web.{{PRODUCT_NAME}}.localhost:{{PORTLESS_PROXY_PORT}}
`,
  },
  "frontend-.env.local": {
    content: `REACT_APP_BRANCH_NAME={{BRANCH_NAME}}
REACT_APP_PRODUCT_NAME={{PRODUCT_NAME}}
REACT_APP_PORTLESS_PROXY_PORT={{PORTLESS_PROXY_PORT}}
REACT_APP_FRONTEND_PORT={{FRONTEND_PORT}}
REACT_APP_API_URL=https://{{BRANCH_SLUG}}.api.{{PRODUCT_NAME}}.localhost:{{PORTLESS_PROXY_PORT}}/api
REACT_APP_WEB_URL=https://{{BRANCH_SLUG}}.web.{{PRODUCT_NAME}}.localhost:{{PORTLESS_PROXY_PORT}}
`,
  },
  "manager-.env.local": {
    content: `PORT={{MANAGER_PORT}}
VITE_BRANCH_NAME={{BRANCH_NAME}}
VITE_PRODUCT_NAME={{PRODUCT_NAME}}
VITE_PORTLESS_PROXY_PORT={{PORTLESS_PROXY_PORT}}
VITE_API_URL=https://{{BRANCH_SLUG}}.api.{{PRODUCT_NAME}}.localhost:{{PORTLESS_PROXY_PORT}}/api
VITE_WEB_URL=https://{{BRANCH_SLUG}}.web.{{PRODUCT_NAME}}.localhost:{{PORTLESS_PROXY_PORT}}
VITE_APP_URL=https://{{BRANCH_SLUG}}.manager.{{PRODUCT_NAME}}.localhost:{{PORTLESS_PROXY_PORT}}
`,
  },
  "vscode/settings.json": {
    content: `{
  "files.exclude": {
    "**/.DS_Store": true
  },
  "workspace.branchName": "{{BRANCH_NAME}}",
  "workspace.dbPort": "{{DB_PORT}}"
}
`,
  },
  "vscode/tasks.json": {
    content: `{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "Backend",
      "type": "shell",
      "command": "echo Backend {{BRANCH_NAME}} on {{BACKEND_PORT}}"
    },
    {
      "label": "Frontend",
      "type": "shell",
      "command": "echo Frontend {{BRANCH_NAME}} on {{FRONTEND_PORT}}"
    }
  ]
}
`,
  },
  "vscode/launch.json": {
    content: `{
  "version": "0.2.0",
  "configurations": []
}
`,
  },
  "vscode/extensions.json": {
    content: `{
  "recommendations": [
    "ms-azuretools.vscode-docker",
    "esbenp.prettier-vscode"
  ]
}
`,
  },
  "idea/vcs.xml": {
    content: `<project version="4">
  <component name="VcsDirectoryMappings">
    <mapping directory="$PROJECT_DIR$" vcs="Git" />
  </component>
</project>
`,
  },
  "idea/dataSources.xml": {
    content: `<project version="4">
  <component name="DataSourceManagerImpl">
    <data-source source="LOCAL" name="{{BRANCH_NAME}}" uuid="{{UUID}}">
      <jdbc-url>jdbc:postgresql://localhost:{{DB_PORT}}/{{DB_NAME}}</jdbc-url>
    </data-source>
  </component>
</project>
`,
  },
  "idea/misc.xml": {
    content: `<project version="4">
  <component name="ProjectRootManager" version="2" />
</project>
`,
    optional: true,
  },
  "idea/compiler.xml": {
    content: `<project version="4">
  <component name="CompilerConfiguration" />
</project>
`,
    optional: true,
  },
  "idea/encodings.xml": {
    content: `<project version="4">
  <component name="Encoding" />
</project>
`,
    optional: true,
  },
  "idea/jarRepositories.xml": {
    content: `<project version="4">
  <component name="RemoteRepositoriesConfiguration">
    <remote-repository>
      <option name="id" value="central" />
      <option name="name" value="Maven Central repository" />
      <option name="url" value="https://repo1.maven.org/maven2" />
    </remote-repository>
  </component>
</project>
`,
    optional: true,
  },
  "idea/workspace.xml": {
    content: `<project version="4">
  <component name="MavenProjectsManager">
    <option name="originalFiles">
      <list>
        <option value="$PROJECT_DIR$/backend/{{BACKEND_MODULE}}-core/pom.xml" />
      </list>
    </option>
  </component>
</project>
`,
    optional: true,
  },
  "runConfigurations/Backend.xml": {
    content: `<component name="ProjectRunConfigurationManager">
  <configuration default="false" name="Backend {{BRANCH_NAME}}" type="ShConfigurationType">
    <option name="SCRIPT_TEXT" value="cd &quot;$PROJECT_DIR$/backend&quot; &amp;&amp; QUARKUS_HTTP_PORT={{BACKEND_PORT}} QUARKUS_DATASOURCE_JDBC_URL=jdbc:postgresql://localhost:{{DB_PORT}}/{{DB_NAME}} QUARKUS_DATASOURCE_USERNAME={{DB_USER}} QUARKUS_DATASOURCE_PASSWORD={{DB_PASSWORD}} QUARKUS_PROFILE=dev mvn -pl {{BACKEND_MODULE}}-core quarkus:dev -Ddebug={{BACKEND_DEBUG_PORT}}" />
    <option name="INDEPENDENT_SCRIPT_PATH" value="true" />
    <option name="SCRIPT_PATH" value="" />
    <option name="SCRIPT_OPTIONS" value="" />
    <option name="INDEPENDENT_SCRIPT_WORKING_DIRECTORY" value="true" />
    <option name="SCRIPT_WORKING_DIRECTORY" value="$PROJECT_DIR$/backend" />
    <envs />
    <method v="2" />
  </configuration>
</component>
`,
    optional: true,
  },
  "runConfigurations/Backend_Debug.xml": {
    content: `<component name="ProjectRunConfigurationManager">
  <configuration default="false" name="Backend Debug {{BRANCH_NAME}}" type="Remote" factoryName="Remote JVM Debug">
    <option name="USE_SOCKET_TRANSPORT" value="true" />
    <option name="SERVER_MODE" value="false" />
    <option name="HOST" value="localhost" />
    <option name="PORT" value="{{BACKEND_DEBUG_PORT}}" />
    <method v="2" />
  </configuration>
</component>
`,
    optional: true,
  },
  "runConfigurations/Frontend.xml": {
    content: `<component name="ProjectRunConfigurationManager">
  <configuration default="false" name="Frontend {{BRANCH_NAME}}" type="js.build_tools.npm">
    <package-json value="$PROJECT_DIR$/frontend/package.json" />
    <command value="start" />
    <node-interpreter value="project" />
    <envs>
      <env name="REACT_APP_API_URL" value="https://{{BRANCH_SLUG}}.api.{{PRODUCT_NAME}}.localhost:{{PORTLESS_PROXY_PORT}}/api" />
      <env name="REACT_APP_WEB_URL" value="https://{{BRANCH_SLUG}}.web.{{PRODUCT_NAME}}.localhost:{{PORTLESS_PROXY_PORT}}" />
      <env name="REACT_APP_FRONTEND_PORT" value="{{FRONTEND_PORT}}" />
      <env name="REACT_APP_BRANCH_NAME" value="{{BRANCH_NAME}}" />
      <env name="REACT_APP_PRODUCT_NAME" value="{{PRODUCT_NAME}}" />
      <env name="REACT_APP_PORTLESS_PROXY_PORT" value="{{PORTLESS_PROXY_PORT}}" />
    </envs>
    <method v="2" />
  </configuration>
</component>
`,
    optional: true,
  },
};

const LEGACY_BUNDLED_TEMPLATES: Record<string, string[]> = {
  "workspace.env": [`BRANCH_NAME="{{BRANCH_NAME}}"
BRANCH_SLUG="{{BRANCH_SLUG}}"
DB_PORT="{{DB_PORT}}"
BACKEND_PORT="{{BACKEND_PORT}}"
BACKEND_DEBUG_PORT="{{BACKEND_DEBUG_PORT}}"
FRONTEND_PORT="{{FRONTEND_PORT}}"
MANAGER_PORT="{{MANAGER_PORT}}"
DB_VOLUME="{{DB_VOLUME}}"
DB_CONTAINER="{{DB_CONTAINER}}"
COMPOSE_PROJECT="{{COMPOSE_PROJECT}}"
CREATED_AT="{{CREATED_AT}}"
SEEDED_FROM="{{SEEDED_FROM}}"
`],
  "backend-application-dev.properties": [`quarkus.http.port={{BACKEND_PORT}}
quarkus.datasource.jdbc.url=jdbc:postgresql://localhost:{{DB_PORT}}/app_database
quarkus.datasource.username=postgres
quarkus.datasource.password=docker
workspace.branch.name={{BRANCH_NAME}}
%dev.neurosteps.frontend.url=https://{{BRANCH_SLUG}}.web.{{PRODUCT_NAME}}.localhost:{{PORTLESS_PROXY_PORT}}
`],
  "idea/dataSources.xml": [`<project version="4">
  <component name="DataSourceManagerImpl">
    <data-source source="LOCAL" name="{{BRANCH_NAME}}" uuid="{{UUID}}">
      <jdbc-url>jdbc:postgresql://localhost:{{DB_PORT}}/app_database</jdbc-url>
    </data-source>
  </component>
</project>
`],
  "runConfigurations/Backend.xml": [`<component name="ProjectRunConfigurationManager">
  <configuration default="false" name="Backend {{BRANCH_NAME}}" type="ShConfigurationType">
    <option name="SCRIPT_TEXT" value="cd &quot;$PROJECT_DIR$/backend&quot; &amp;&amp; QUARKUS_HTTP_PORT={{BACKEND_PORT}} QUARKUS_DATASOURCE_JDBC_URL=jdbc:postgresql://localhost:{{DB_PORT}}/app_database QUARKUS_PROFILE=dev mvn -pl {{BACKEND_MODULE}}-core quarkus:dev -Ddebug={{BACKEND_DEBUG_PORT}}" />
    <option name="INDEPENDENT_SCRIPT_PATH" value="true" />
    <option name="SCRIPT_PATH" value="" />
    <option name="SCRIPT_OPTIONS" value="" />
    <option name="INDEPENDENT_SCRIPT_WORKING_DIRECTORY" value="true" />
    <option name="SCRIPT_WORKING_DIRECTORY" value="$PROJECT_DIR$/backend" />
    <envs />
    <method v="2" />
  </configuration>
</component>
`],
};

export interface BootstrapPaths {
  workspaceDir?: string;
  templatesDir?: string;
  snapshotsDir?: string;
  configDir?: string;
  worktreesDir?: string;
}

export interface BootstrapResult {
  createdDirs: string[];
  installedTemplates: string[];
  updatedTemplates: string[];
  preservedTemplates: string[];
}

function resolvePaths(paths: BootstrapPaths = {}) {
  const workspaceDir = paths.workspaceDir ?? WORKSPACE_DIR;
  const templatesDir = paths.templatesDir ?? join(workspaceDir, "templates");
  const snapshotsDir = paths.snapshotsDir ?? join(workspaceDir, "snapshots");
  const configDir = paths.configDir ?? join(workspaceDir, "config");
  const worktreesDir = paths.worktreesDir ?? WORKTREES_DIR;

  return {
    workspaceDir,
    templatesDir,
    snapshotsDir,
    configDir,
    worktreesDir,
  };
}

function ensureDir(dir: string, createdDirs: string[]): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    createdDirs.push(dir);
    return;
  }

  mkdirSync(dir, { recursive: true });
}

async function tryReadFileText(filePath: string): Promise<string | null> {
  try {
    const file = Bun.file(filePath) as { text?: () => Promise<string> };
    if (typeof file.text !== "function") return null;
    return await file.text();
  } catch {
    return null;
  }
}

export async function ensureWorkspaceBootstrap(
  paths: BootstrapPaths = {},
): Promise<BootstrapResult> {
  const resolved = resolvePaths(paths);
  const createdDirs: string[] = [];
  const installedTemplates: string[] = [];
  const updatedTemplates: string[] = [];
  const preservedTemplates: string[] = [];

  for (const dir of [
    resolved.worktreesDir,
    resolved.workspaceDir,
    resolved.templatesDir,
    resolved.snapshotsDir,
    resolved.configDir,
    join(resolved.templatesDir, "vscode"),
    join(resolved.templatesDir, "idea"),
    join(resolved.templatesDir, "runConfigurations"),
  ]) {
    ensureDir(dir, createdDirs);
  }

  for (const [relativePath, spec] of Object.entries(BUNDLED_TEMPLATES)) {
    const filePath = join(resolved.templatesDir, relativePath);
    ensureDir(dirname(filePath), createdDirs);

    if (existsSync(filePath)) {
      const legacyContents = LEGACY_BUNDLED_TEMPLATES[relativePath] ?? [];
      const existingContent = await tryReadFileText(filePath);
      if (existingContent !== null && legacyContents.includes(existingContent)) {
        await Bun.write(filePath, spec.content);
        updatedTemplates.push(relativePath);
        continue;
      }

      preservedTemplates.push(relativePath);
      continue;
    }

    await Bun.write(filePath, spec.content);
    installedTemplates.push(relativePath);
  }

  return { createdDirs, installedTemplates, updatedTemplates, preservedTemplates };
}

export async function ensureBundledTemplate(relativePath: string): Promise<string> {
  const spec = BUNDLED_TEMPLATES[relativePath];
  if (!spec) {
    throw new Error(`Unknown bundled template: ${relativePath}`);
  }

  const templatePath = join(TEMPLATES_DIR, relativePath);
  if (!existsSync(templatePath)) {
    await ensureWorkspaceBootstrap();
  }

  return templatePath;
}

export function listBundledTemplates(): Array<{ path: string; optional: boolean }> {
  return Object.entries(BUNDLED_TEMPLATES).map(([path, spec]) => ({
    path,
    optional: Boolean(spec.optional),
  }));
}
