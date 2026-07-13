import { readdirSync, statSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { input, confirm } from "@inquirer/prompts";
import { writeEnvFile, readEnvFile } from "../lib/settings";
import { detail, emptyLine, heading, ok, spinner, info, warn } from "../lib/logger";
import { reloadEnv } from "../lib/env";
import { getNextPort, isPortAvailable } from "../lib/ports";
import { ensureWorkspaceBootstrap } from "../lib/bootstrap";
import { assertInteractiveInput } from "../lib/prompt";

function fileExistsSync(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function detectGitRepos(baseDir: string): Array<{ name: string; path: string }> {
  const repos: Array<{ name: string; path: string }> = [];
  try {
    const entries = readdirSync(baseDir);
    for (const entry of entries) {
      const fullPath = join(baseDir, entry);
      if (statSync(fullPath).isDirectory() && fileExistsSync(join(fullPath, ".git"))) {
        repos.push({ name: entry, path: fullPath });
      }
    }
  } catch {
    // ignore
  }
  return repos;
}

function classifyRepo(name: string): "backend" | "frontend" | "manager" | "docs" | "other" {
  const lower = name.toLowerCase();
  if (lower === "docs" || lower.includes("documentation")) return "docs";
  if (lower.includes("backend") || lower.includes("api") || lower.includes("server")) return "backend";
  if (lower.includes("frontend") || lower.includes("web") || lower.includes("client")) return "frontend";
  if (lower.includes("manager") || lower.includes("admin") || lower.includes("dashboard")) return "manager";
  return "other";
}

function detectBackendModule(repoPath: string): string | undefined {
  try {
    const pomPath = join(repoPath, "pom.xml");
    const content = Bun.file(pomPath).textSync();
    const match = content.match(/<artifactId>([^<]+)<\/artifactId>/);
    return match?.[1];
  } catch {
    return undefined;
  }
}

function detectBackendCoreModule(repoPath: string): string | undefined {
  try {
    const pomPath = join(repoPath, "pom.xml");
    const content = Bun.file(pomPath).textSync();
    const modulesMatch = content.match(/<modules>([\s\S]*?)<\/modules>/);
    if (modulesMatch) {
      const modulesContent = modulesMatch[1];
      const moduleMatches = modulesContent.match(/<module>([^<]+)<\/module>/g);
      if (moduleMatches) {
        // Prefer module with "-core" suffix, fallback to first module
        const coreModule = moduleMatches.find((m) => m.includes("-core"));
        if (coreModule) {
          return coreModule.replace(/<module>|<\/module>/g, "").trim();
        }
        return moduleMatches[0].replace(/<module>|<\/module>/g, "").trim();
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function detectProductNameFromFrontend(repoPath: string): string | undefined {
  try {
    const packageJsonPath = join(repoPath, "package.json");
    const content = Bun.file(packageJsonPath).textSync();
    const parsed = JSON.parse(content);
    return parsed.name;
  } catch {
    return undefined;
  }
}

interface InitOptions {
  reconfig?: boolean;
}

type ExistingEnv = Record<string, string | undefined>;

async function promptForPort(
  key: string,
  message: string,
  existing: ExistingEnv,
  config: Record<string, string | number>,
  fallback: number,
  opts: InitOptions,
): Promise<number> {
  if (existing[key] && !opts.reconfig) {
    const value = Number(existing[key]);
    config[key] = value;
    detail(key, value);
    return value;
  }

  let current = Number(existing[key] || fallback);
  while (true) {
    const answer = await input({
      message,
      default: String(current),
    });
    const port = Number(answer);
    if (!Number.isInteger(port) || port <= 0) {
      warn("Porta inválida. Informe um número inteiro positivo.");
      continue;
    }
    if (!isPortAvailable(port)) {
      const next = getNextPort(port + 1);
      warn(`Porta ${port} já está em uso. Sugestão: ${next}`);
      current = next;
      continue;
    }
    config[key] = port;
    return port;
  }
}

export async function initAction(opts: InitOptions = {}): Promise<void> {
  assertInteractiveInput("configurar a CLI");

  // ─── Check existing config ───
  const fileVars = await readEnvFile();
  const shellVars = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => k.startsWith("NS_"))
  );
  const existing = { ...fileVars, ...shellVars };

  const requiredVars = [
    "NS_PRODUCT_NAME",
    "NS_BACKEND_MODULE",
    "NS_BACKEND_REPO_NAME",
    "NS_MANAGER_REPO_NAME",
    "NS_SEED_VOLUME",
  ];

  const missing = requiredVars.filter((k) => !existing[k] || existing[k] === "");
  const hasAllRequired = missing.length === 0;

  if (hasAllRequired && !opts.reconfig) {
    info("Configuração já existe. Use --reconfig para reconfigurar.");
    console.log("");
    console.log("Config atual:");
    for (const k of requiredVars) {
      detail(k, existing[k] || "(vazio)");
    }
    console.log("");
    const proceed = await confirm({
      message: "Continuar preparando o workspace local da CLI?",
      default: true,
    });
    if (!proceed) return;
  }

  // ─── Wizard ───
  console.log("");
  heading("Configuração do Workspace CLI");
  console.log("");

  const config: Record<string, string | number> = {};
  const askIfNeeded = async (key: string, message: string, fallback = "") => {
    if (existing[key] && !opts.reconfig) {
      config[key] = existing[key]!;
      detail(key, existing[key]!);
      return String(existing[key]!);
    }

    const value = await input({
      message,
      default: existing[key] || fallback,
    });
    config[key] = value;
    return value;
  };

  // 1. Base dir
  const baseDir = await askIfNeeded(
    "NS_BASE_DIR",
    "Diretório base (onde ficam os repos):",
    join(homedir(), "Developer"),
  );

  // 2. Auto-detect repos in base dir
  const detected = detectGitRepos(baseDir);
  const detectedBackend = detected.find((r) => classifyRepo(r.name) === "backend");
  const detectedFrontend = detected.find((r) => classifyRepo(r.name) === "frontend");
  const detectedManager = detected.find((r) => classifyRepo(r.name) === "manager");
  const detectedDocs = detected.find((r) => classifyRepo(r.name) === "docs");

  // Auto-detect values from repos
  const autoBackendModule = detectedBackend ? detectBackendModule(detectedBackend.path) : undefined;
  const autoBackendCoreModule = detectedBackend ? detectBackendCoreModule(detectedBackend.path) : undefined;
  const autoProductName = detectedFrontend ? detectProductNameFromFrontend(detectedFrontend.path) : undefined;

  // 3. Required identity vars — use detected values as defaults
  const productName = await askIfNeeded(
    "NS_PRODUCT_NAME",
    "Nome do produto (para aliases, volumes, containers):",
    autoProductName || "",
  );

  const backendModule = await askIfNeeded(
    "NS_BACKEND_MODULE",
    "Nome do módulo backend (ex: scalemed):",
    autoBackendModule || "",
  );

  await askIfNeeded(
    "NS_BACKEND_CORE_MODULE",
    "Nome do módulo core do backend (ex: scalemed-core):",
    autoBackendCoreModule || `${backendModule}-core`,
  );

  const backendRepoName = await askIfNeeded(
    "NS_BACKEND_REPO_NAME",
    "Nome da pasta do repo backend:",
    detectedBackend?.name || "",
  );

  await askIfNeeded(
    "NS_MANAGER_REPO_NAME",
    "Nome da pasta do repo manager:",
    detectedManager?.name || "",
  );

  await askIfNeeded(
    "NS_DOCS_REPO_NAME",
    "Nome da pasta do repo docs:",
    detectedDocs?.name || "docs",
  );

  // 5. Confirm detected repo paths
  console.log("");
  info("Repos detectados em " + baseDir + ":");
  if (detectedBackend) ok(`  [backend] ${detectedBackend.name}`);
  if (detectedFrontend) ok(`  [frontend] ${detectedFrontend.name}`);
  if (detectedManager) ok(`  [manager] ${detectedManager.name}`);
  if (detectedDocs) ok(`  [docs] ${detectedDocs.name}`);

  if (detectedBackend || detectedFrontend || detectedManager || detectedDocs) {
    const useDetected = await confirm({
      message: "Usar caminhos detectados?",
      default: true,
    });

    if (useDetected) {
      if (detectedBackend) config.NS_BACKEND_REPO = detectedBackend.path;
      if (detectedFrontend) config.NS_FRONTEND_REPO = detectedFrontend.path;
      if (detectedManager) config.NS_MANAGER_REPO = detectedManager.path;
      if (detectedDocs) config.NS_DOCS_REPO = detectedDocs.path;
    }
  }

  // 6. Seed volume
  console.log("");
  await askIfNeeded(
    "NS_SEED_VOLUME",
    "Nome completo do volume Docker de seed:",
    `${backendRepoName}_${productName}_bd_volume`,
  );

  // 7. Advanced config (optional)
  console.log("");
  const advanced = await confirm({
    message: "Configurar portas e credenciais avançadas?",
    default: false,
  });

  if (advanced) {
    const dbUser = await input({ message: "PostgreSQL user:", default: existing.NS_DB_USER || "postgres" });
    config.NS_DB_USER = dbUser;

    const dbPassword = await input({ message: "PostgreSQL password:", default: existing.NS_DB_PASSWORD || "docker" });
    config.NS_DB_PASSWORD = dbPassword;

    const dbName = await input({ message: "PostgreSQL database:", default: existing.NS_DB_NAME || "app_database" });
    config.NS_DB_NAME = dbName;

    await promptForPort(
      "NS_PORTLESS_PROXY_PORT",
      "Portless proxy port:",
      existing,
      config,
      1355,
      opts,
    );

    await promptForPort(
      "NS_MASTER_DB_PORT",
      "Master DB port:",
      existing,
      config,
      5434,
      opts,
    );

    await promptForPort(
      "NS_MASTER_BACKEND_PORT",
      "Master backend port:",
      existing,
      config,
      8080,
      opts,
    );

    await promptForPort(
      "NS_MASTER_FRONTEND_PORT",
      "Master frontend port:",
      existing,
      config,
      3011,
      opts,
    );

    await promptForPort(
      "NS_MASTER_MANAGER_PORT",
      "Master manager port:",
      existing,
      config,
      3020,
      opts,
    );
  } else {
    // Copy defaults if they exist in shell/file
    if (existing.NS_DB_USER) config.NS_DB_USER = existing.NS_DB_USER;
    if (existing.NS_DB_PASSWORD) config.NS_DB_PASSWORD = existing.NS_DB_PASSWORD;
    if (existing.NS_DB_NAME) config.NS_DB_NAME = existing.NS_DB_NAME;
    config.NS_PORTLESS_PROXY_PORT = Number(existing.NS_PORTLESS_PROXY_PORT || 1355);
    config.NS_MASTER_DB_PORT = Number(existing.NS_MASTER_DB_PORT || 5434);
    config.NS_MASTER_BACKEND_PORT = Number(existing.NS_MASTER_BACKEND_PORT || 8080);
    config.NS_MASTER_FRONTEND_PORT = Number(existing.NS_MASTER_FRONTEND_PORT || 3011);
    config.NS_MASTER_MANAGER_PORT = Number(existing.NS_MASTER_MANAGER_PORT || 3020);

    const portsToCheck = [
      ["NS_PORTLESS_PROXY_PORT", Number(config.NS_PORTLESS_PROXY_PORT)],
      ["NS_MASTER_DB_PORT", Number(config.NS_MASTER_DB_PORT)],
      ["NS_MASTER_BACKEND_PORT", Number(config.NS_MASTER_BACKEND_PORT)],
      ["NS_MASTER_FRONTEND_PORT", Number(config.NS_MASTER_FRONTEND_PORT)],
      ["NS_MASTER_MANAGER_PORT", Number(config.NS_MASTER_MANAGER_PORT)],
    ] as const;

    for (const [key, port] of portsToCheck) {
      if (!isPortAvailable(port)) {
        warn(`${key}=${port} já está em uso. Rode com configuração avançada para alterar.`);
      }
    }
  }

  // ─── Summary ───
  const summary = {
    NS_BASE_DIR: String(config.NS_BASE_DIR ?? existing.NS_BASE_DIR ?? join(homedir(), "Developer")),
    NS_PRODUCT_NAME: String(config.NS_PRODUCT_NAME ?? existing.NS_PRODUCT_NAME ?? ""),
    NS_BACKEND_MODULE: String(config.NS_BACKEND_MODULE ?? existing.NS_BACKEND_MODULE ?? ""),
    NS_BACKEND_CORE_MODULE: String(config.NS_BACKEND_CORE_MODULE ?? existing.NS_BACKEND_CORE_MODULE ?? `${String(config.NS_BACKEND_MODULE ?? existing.NS_BACKEND_MODULE ?? "")}-core`),
    NS_BACKEND_REPO_NAME: String(config.NS_BACKEND_REPO_NAME ?? existing.NS_BACKEND_REPO_NAME ?? ""),
    NS_MANAGER_REPO_NAME: String(config.NS_MANAGER_REPO_NAME ?? existing.NS_MANAGER_REPO_NAME ?? ""),
    NS_DOCS_REPO_NAME: String(config.NS_DOCS_REPO_NAME ?? existing.NS_DOCS_REPO_NAME ?? "docs"),
    NS_SEED_VOLUME: String(config.NS_SEED_VOLUME ?? existing.NS_SEED_VOLUME ?? ""),
    NS_BACKEND_REPO: String(config.NS_BACKEND_REPO ?? existing.NS_BACKEND_REPO ?? join(String(config.NS_BASE_DIR ?? existing.NS_BASE_DIR ?? join(homedir(), "Developer")), String(config.NS_BACKEND_REPO_NAME ?? existing.NS_BACKEND_REPO_NAME ?? ""))),
    NS_FRONTEND_REPO: String(config.NS_FRONTEND_REPO ?? existing.NS_FRONTEND_REPO ?? join(String(config.NS_BASE_DIR ?? existing.NS_BASE_DIR ?? join(homedir(), "Developer")), "frontend")),
    NS_MANAGER_REPO: String(config.NS_MANAGER_REPO ?? existing.NS_MANAGER_REPO ?? join(String(config.NS_BASE_DIR ?? existing.NS_BASE_DIR ?? join(homedir(), "Developer")), String(config.NS_MANAGER_REPO_NAME ?? existing.NS_MANAGER_REPO_NAME ?? ""))),
    NS_DOCS_REPO: String(config.NS_DOCS_REPO ?? existing.NS_DOCS_REPO ?? join(String(config.NS_BASE_DIR ?? existing.NS_BASE_DIR ?? join(homedir(), "Developer")), String(config.NS_DOCS_REPO_NAME ?? existing.NS_DOCS_REPO_NAME ?? "docs"))),
    NS_DB_USER: String(config.NS_DB_USER ?? existing.NS_DB_USER ?? "postgres"),
    NS_DB_PASSWORD: String(config.NS_DB_PASSWORD ?? existing.NS_DB_PASSWORD ?? "docker"),
    NS_DB_NAME: String(config.NS_DB_NAME ?? existing.NS_DB_NAME ?? "app_database"),
    NS_PORTLESS_PROXY_PORT: Number(config.NS_PORTLESS_PROXY_PORT ?? existing.NS_PORTLESS_PROXY_PORT ?? 1355),
    NS_MASTER_DB_PORT: Number(config.NS_MASTER_DB_PORT ?? existing.NS_MASTER_DB_PORT ?? 5434),
    NS_MASTER_BACKEND_PORT: Number(config.NS_MASTER_BACKEND_PORT ?? existing.NS_MASTER_BACKEND_PORT ?? 8080),
    NS_MASTER_FRONTEND_PORT: Number(config.NS_MASTER_FRONTEND_PORT ?? existing.NS_MASTER_FRONTEND_PORT ?? 3011),
    NS_MASTER_MANAGER_PORT: Number(config.NS_MASTER_MANAGER_PORT ?? existing.NS_MASTER_MANAGER_PORT ?? 3020),
  };

  console.log("");
  heading("Resumo da Configuração");
  for (const [key, value] of Object.entries(summary)) {
    detail(key, value);
  }
  console.log("");
  const saveConfig = await confirm({
    message: "Salvar essa configuração e bootstrapar o workspace local?",
    default: true,
  });
  if (!saveConfig) {
    warn("Configuração cancelada.");
    return;
  }

  // ─── Save config ───
  console.log("");
  await writeEnvFile(summary);
  ok("Configuração salva em ~/.config/ns/env.json");

  // Reload env for future commands in the same process.
  await reloadEnv();

  // ─── Bootstrap workspace filesystem ───
  console.log("");
  const effective = {
    NS_BASE_DIR: String(config.NS_BASE_DIR ?? existing.NS_BASE_DIR ?? join(homedir(), "Developer")),
    NS_PRODUCT_NAME: String(config.NS_PRODUCT_NAME ?? existing.NS_PRODUCT_NAME ?? ""),
  };

  const worktreesDir = join(effective.NS_BASE_DIR, "worktrees");
  const workspaceDir = join(effective.NS_BASE_DIR, `${effective.NS_PRODUCT_NAME}-workspace`);
  const templatesDir = join(workspaceDir, "templates");
  const snapshotsDir = join(workspaceDir, "snapshots");
  const configDir = join(workspaceDir, "config");

  const s = spinner("Bootstrapando diretórios e templates da CLI...").start();
  const bootstrap = await ensureWorkspaceBootstrap({
    workspaceDir,
    templatesDir,
    snapshotsDir,
    configDir,
    worktreesDir,
  });

  s.succeed("Workspace local bootstrapado!");
  emptyLine();
  heading("Estrutura criada");
  detail("Workspace", workspaceDir);
  detail("Templates", templatesDir);
  detail("Snapshots", snapshotsDir);
  detail("Config", configDir);
  detail("Worktrees", worktreesDir);
  detail("Novos diretórios", bootstrap.createdDirs.length);
  detail("Templates instalados", bootstrap.installedTemplates.length);
  detail("Templates atualizados", bootstrap.updatedTemplates.length);
  detail("Templates preservados", bootstrap.preservedTemplates.length);
  emptyLine();
  heading("Próximos passos");
  console.log("  1. ns new <branch>      # criar worktree git da branch");
  console.log("  2. ns prepare <branch>  # iniciar DB + aliases");
  console.log("  3. ns open <branch>     # abrir no IDE");
}
