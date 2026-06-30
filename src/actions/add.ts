import { join } from "path";
import {
  BACKEND_CORE_MODULE,
  MANAGER_REPO,
  REPORT_SERVER_REPO,
  PORTLESS_PROXY_PORT,
  PRODUCT_NAME,
  WORKSPACE_DIR,
  WORKTREES_DIR,
  readWorkspaceEnv,
} from "../lib/config";
import {
  branchExistsOnOrigin,
  createLocalBranch,
  createTrackingBranch,
  createWorktree,
  fetchOrigin,
  localBranchExists,
} from "../lib/git";
import { getNextPort } from "../lib/ports";
import { copyTemplate } from "../lib/templates";
import { exec, execChecked } from "../lib/shell";
import { detail, emptyLine, section, spinner } from "../lib/logger";
import { ensureWorkspaceBootstrap } from "../lib/bootstrap";
import { MASTER_MANAGER_PORT, MASTER_REPORT_SERVER_PORT } from "../lib/env";
import { pathExists } from "../lib/filesystem";

function updateManagerPort(content: string, port: number): string {
  const line = `MANAGER_PORT="${port}"`;
  if (/^MANAGER_PORT=.*/m.test(content)) {
    return content.replace(/^MANAGER_PORT=.*/m, line);
  }
  return content.endsWith("\n") ? `${content}${line}\n` : `${content}\n${line}\n`;
}

async function addManagerToCodeWorkspace(workspaceFile: string, exists: (path: string) => boolean): Promise<void> {
  if (!exists(workspaceFile)) {
    return;
  }

  const content = await Bun.file(workspaceFile).text();
  const parsed = JSON.parse(content) as { folders?: Array<{ name?: string; path?: string }>; [key: string]: unknown };
  const folders = Array.isArray(parsed.folders) ? parsed.folders : [];

  if (!folders.some((folder) => folder.path === "manager" || folder.name === "manager")) {
    folders.push({ name: "manager", path: "manager" });
  }

  parsed.folders = folders;
  await Bun.write(workspaceFile, `${JSON.stringify(parsed, null, 2)}\n`);
}

interface AddManagerDeps {
  readEnv: typeof readWorkspaceEnv;
  fetch: typeof fetchOrigin;
  branchExistsOrigin: typeof branchExistsOnOrigin;
  localExists: typeof localBranchExists;
  trackBranch: typeof createTrackingBranch;
  localBranch: typeof createLocalBranch;
  worktree: typeof createWorktree;
  allocateManagerPort: () => number;
  shell: typeof exec;
  exists: (path: string) => boolean;
  ensureBootstrap: typeof ensureWorkspaceBootstrap;
  copyTpl: typeof copyTemplate;
  readText: (path: string) => Promise<string>;
  writeText: (path: string, content: string) => Promise<unknown>;
}

const defaultDeps: AddManagerDeps = {
  readEnv: readWorkspaceEnv,
  fetch: fetchOrigin,
  branchExistsOrigin: branchExistsOnOrigin,
  localExists: localBranchExists,
  trackBranch: createTrackingBranch,
  localBranch: createLocalBranch,
  worktree: createWorktree,
  allocateManagerPort: () => getNextPort(MASTER_MANAGER_PORT),
  shell: execChecked,
  exists: pathExists,
  ensureBootstrap: ensureWorkspaceBootstrap,
  copyTpl: copyTemplate,
  readText: (path: string) => Bun.file(path).text(),
  writeText: (path: string, content: string) => Bun.write(path, content),
};

export async function addManagerAction(
  branch: string,
  opts: { base?: string; port?: string | number } = {},
  deps: Partial<AddManagerDeps> = {},
): Promise<void> {
  const {
    readEnv,
    fetch,
    branchExistsOrigin,
    localExists,
    trackBranch,
    localBranch,
    worktree,
    allocateManagerPort,
    shell,
    exists,
    ensureBootstrap,
    copyTpl,
    readText,
    writeText,
  } = { ...defaultDeps, ...deps };

  const s = spinner(`Adicionando manager em ${branch}...`).start();

  const wtDir = join(WORKTREES_DIR, branch);
  const workspaceEnv = join(wtDir, ".workspace.env");
  const managerDir = join(wtDir, "manager");
  const baseBranch = opts.base || "master";
  const baseOriginBranch = baseBranch.replace(/^origin\//, "");
  const baseRef = `origin/${baseOriginBranch}`;

  const env = await readEnv(branch);
  if (!env || !exists(workspaceEnv)) {
    s.fail(`Worktree '${branch}' não encontrada`);
    process.exit(1);
  }

  if (exists(managerDir)) {
    s.fail(`Manager já existe em ${managerDir}`);
    process.exit(1);
  }

  if (!exists(join(MANAGER_REPO, ".git"))) {
    s.fail(`Repositório Manager não encontrado em ${MANAGER_REPO}`);
    process.exit(1);
  }

  const requestedPort = opts.port === undefined || opts.port === "" ? undefined : Number(opts.port);
  if (requestedPort !== undefined && (!Number.isInteger(requestedPort) || requestedPort <= 0)) {
    s.fail(`Porta inválida: ${opts.port}`);
    process.exit(1);
  }

  const managerPort = requestedPort ?? env.MANAGER_PORT ?? allocateManagerPort();

  await ensureBootstrap();

  s.text = "Configurando branch do manager...";
  await fetch(MANAGER_REPO);
  const hasRemote = await branchExistsOrigin(MANAGER_REPO, branch);
  if (hasRemote) {
    if (!localExists(MANAGER_REPO, branch)) {
      await trackBranch(MANAGER_REPO, branch);
    }
  } else if (!localExists(MANAGER_REPO, branch)) {
    if (!(await branchExistsOrigin(MANAGER_REPO, baseOriginBranch))) {
      s.fail(`Branch base '${baseRef}' não existe no manager`);
      process.exit(1);
    }
    await localBranch(MANAGER_REPO, branch, baseRef);
  }

  s.text = "Criando worktree do manager...";
  await shell(["mkdir", "-p", wtDir], { silent: true });
  await worktree(MANAGER_REPO, managerDir, branch);

  s.text = "Atualizando configuração da workspace...";
  const envContent = await readText(workspaceEnv);
  await writeText(workspaceEnv, updateManagerPort(envContent, managerPort));

  await copyTpl(join(WORKSPACE_DIR, "templates/manager-.env.local"), join(managerDir, ".env.local"), {
    BRANCH_NAME: branch,
    BRANCH_SLUG: env.BRANCH_SLUG,
    MANAGER_PORT: String(managerPort),
    PRODUCT_NAME,
    PORTLESS_PROXY_PORT: String(PORTLESS_PROXY_PORT),
  });

  await addManagerToCodeWorkspace(join(wtDir, `${branch}.code-workspace`), exists);

  s.succeed(`Manager adicionado em '${branch}'`);
  emptyLine();
  section("Paths");
  detail("Manager", managerDir);
  section("Portas");
  detail("Manager", `localhost:${managerPort}`);
  section("Próximos passos");
  detail("1", `ns prepare ${branch}`);
  detail("2", `ns open ${branch}`);
}

function updateReportServerPort(content: string, port: number): string {
  const line = `REPORT_SERVER_PORT="${port}"`;
  if (/^REPORT_SERVER_PORT=.*/m.test(content)) {
    return content.replace(/^REPORT_SERVER_PORT=.*/m, line);
  }
  return content.endsWith("\n") ? `${content}${line}\n` : `${content}\n${line}\n`;
}

function upsertProperty(content: string, key: string, value: string): string {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=.*`, "m");

  if (pattern.test(content)) {
    return content.replace(pattern, line);
  }

  return content.endsWith("\n") ? `${content}${line}\n` : `${content}\n${line}\n`;
}

function updateReportServerBackendProperties(content: string, reportServerUrl: string): string {
  let result = content;
  result = upsertProperty(result, "%dev.quarkus.tls.trust-all", "true");
  result = upsertProperty(result, "%dev.quarkus.rest-client.report-service.url", reportServerUrl);
  return result;
}

async function addReportServerToCodeWorkspace(workspaceFile: string, exists: (path: string) => boolean): Promise<void> {
  if (!exists(workspaceFile)) {
    return;
  }

  const content = await Bun.file(workspaceFile).text();
  const parsed = JSON.parse(content) as { folders?: Array<{ name?: string; path?: string }>; [key: string]: unknown };
  const folders = Array.isArray(parsed.folders) ? parsed.folders : [];

  if (!folders.some((folder) => folder.path === "report-server" || folder.name === "report-server")) {
    folders.push({ name: "report-server", path: "report-server" });
  }

  parsed.folders = folders;
  await Bun.write(workspaceFile, `${JSON.stringify(parsed, null, 2)}\n`);
}

interface AddReportServerDeps {
  readEnv: typeof readWorkspaceEnv;
  fetch: typeof fetchOrigin;
  branchExistsOrigin: typeof branchExistsOnOrigin;
  localExists: typeof localBranchExists;
  trackBranch: typeof createTrackingBranch;
  localBranch: typeof createLocalBranch;
  worktree: typeof createWorktree;
  allocateReportServerPort: () => number;
  shell: typeof exec;
  exists: (path: string) => boolean;
  ensureBootstrap: typeof ensureWorkspaceBootstrap;
  copyTpl: typeof copyTemplate;
  readText: (path: string) => Promise<string>;
  writeText: (path: string, content: string) => Promise<unknown>;
}

const defaultReportServerDeps: AddReportServerDeps = {
  readEnv: readWorkspaceEnv,
  fetch: fetchOrigin,
  branchExistsOrigin: branchExistsOnOrigin,
  localExists: localBranchExists,
  trackBranch: createTrackingBranch,
  localBranch: createLocalBranch,
  worktree: createWorktree,
  allocateReportServerPort: () => getNextPort(MASTER_REPORT_SERVER_PORT),
  shell: execChecked,
  exists: pathExists,
  ensureBootstrap: ensureWorkspaceBootstrap,
  copyTpl: copyTemplate,
  readText: (path: string) => Bun.file(path).text(),
  writeText: (path: string, content: string) => Bun.write(path, content),
};

export async function addReportServerAction(
  branch: string,
  opts: { base?: string; port?: string | number } = {},
  deps: Partial<AddReportServerDeps> = {},
): Promise<void> {
  const {
    readEnv,
    fetch,
    branchExistsOrigin,
    localExists,
    trackBranch,
    localBranch,
    worktree,
    allocateReportServerPort,
    shell,
    exists,
    ensureBootstrap,
    copyTpl,
    readText,
    writeText,
  } = { ...defaultReportServerDeps, ...deps };

  const s = spinner(`Adicionando report-server em ${branch}...`).start();

  const wtDir = join(WORKTREES_DIR, branch);
  const workspaceEnv = join(wtDir, ".workspace.env");
  const reportServerDir = join(wtDir, "report-server");
  const backendProps = join(wtDir, `backend/${BACKEND_CORE_MODULE}/src/main/resources/application-dev.properties`);
  const baseBranch = opts.base || "master";
  const baseOriginBranch = baseBranch.replace(/^origin\//, "");
  const baseRef = `origin/${baseOriginBranch}`;

  const env = await readEnv(branch);
  if (!env || !exists(workspaceEnv)) {
    s.fail(`Worktree '${branch}' não encontrada`);
    process.exit(1);
  }

  if (exists(reportServerDir)) {
    s.fail(`Report-server já existe em ${reportServerDir}`);
    process.exit(1);
  }

  if (!exists(join(REPORT_SERVER_REPO, ".git"))) {
    s.fail(`Repositório Report-server não encontrado em ${REPORT_SERVER_REPO}`);
    process.exit(1);
  }

  const requestedPort = opts.port === undefined || opts.port === "" ? undefined : Number(opts.port);
  if (requestedPort !== undefined && (!Number.isInteger(requestedPort) || requestedPort <= 0)) {
    s.fail(`Porta inválida: ${opts.port}`);
    process.exit(1);
  }

  const reportServerPort = requestedPort ?? env.REPORT_SERVER_PORT ?? allocateReportServerPort();

  await ensureBootstrap();

  s.text = "Configurando branch do report-server...";
  await fetch(REPORT_SERVER_REPO);
  const hasRemote = await branchExistsOrigin(REPORT_SERVER_REPO, branch);
  if (hasRemote) {
    if (!localExists(REPORT_SERVER_REPO, branch)) {
      await trackBranch(REPORT_SERVER_REPO, branch);
    }
  } else if (!localExists(REPORT_SERVER_REPO, branch)) {
    if (!(await branchExistsOrigin(REPORT_SERVER_REPO, baseOriginBranch))) {
      s.fail(`Branch base '${baseRef}' não existe no report-server`);
      process.exit(1);
    }
    await localBranch(REPORT_SERVER_REPO, branch, baseRef);
  }

  s.text = "Criando worktree do report-server...";
  await shell(["mkdir", "-p", wtDir], { silent: true });
  await worktree(REPORT_SERVER_REPO, reportServerDir, branch);

  s.text = "Atualizando configuração da workspace...";
  const envContent = await readText(workspaceEnv);
  await writeText(workspaceEnv, updateReportServerPort(envContent, reportServerPort));

  if (exists(backendProps)) {
    const reportServerUrl = `https://${env.BRANCH_SLUG}.report-server.${PRODUCT_NAME}.localhost:${PORTLESS_PROXY_PORT}`;
    const backendPropsContent = await readText(backendProps);
    await writeText(backendProps, updateReportServerBackendProperties(backendPropsContent, reportServerUrl));
  }

  await copyTpl(join(WORKSPACE_DIR, "templates/report-server-.env"), join(reportServerDir, ".env"), {
    BRANCH_NAME: branch,
    BRANCH_SLUG: env.BRANCH_SLUG,
    REPORT_SERVER_PORT: String(reportServerPort),
    PRODUCT_NAME,
    PORTLESS_PROXY_PORT: String(PORTLESS_PROXY_PORT),
  });

  await addReportServerToCodeWorkspace(join(wtDir, `${branch}.code-workspace`), exists);

  s.succeed(`Report-server adicionado em '${branch}'`);
  emptyLine();
  section("Paths");
  detail("Report-server", reportServerDir);
  section("Portas");
  detail("Report-server", `localhost:${reportServerPort}`);
  section("Próximos passos");
  detail("1", `ns prepare ${branch}`);
  detail("2", `ns open ${branch}`);
}
