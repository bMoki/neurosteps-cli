import {
  WORKSPACE_DIR,
  WORKTREES_DIR,
  readWorkspaceEnv,
  hasManager,
  PRODUCT_NAME,
  PORTLESS_PROXY_PORT,
  BACKEND_MODULE,
  SEED_VOLUME,
} from "../lib/config";
import { copyTemplate } from "../lib/templates";
import { dockerVolumeExists, dockerVolumeCreate, dockerVolumeCopy } from "../lib/docker";
import { registerAlias, listAliases } from "../lib/portless";
import { colors, heading, spinner } from "../lib/logger";
import { assertSuccess, commandErrorMessage, exec, execSync } from "../lib/shell";
import { ensureWorkspaceBootstrap } from "../lib/bootstrap";
import { dirExists, pathExists } from "../lib/filesystem";
import { join } from "path";

interface DiagnosticoDeps {
  readEnv: typeof readWorkspaceEnv;
  hasMgr: typeof hasManager;
  volumeExists: typeof dockerVolumeExists;
  volumeCreate: typeof dockerVolumeCreate;
  volumeCopy: typeof dockerVolumeCopy;
  register: typeof registerAlias;
  listAliases: typeof listAliases;
  shell: typeof exec;
  shellSync: typeof execSync;
}

const defaultDeps: DiagnosticoDeps = {
  readEnv: readWorkspaceEnv,
  hasMgr: hasManager,
  volumeExists: dockerVolumeExists,
  volumeCreate: dockerVolumeCreate,
  volumeCopy: dockerVolumeCopy,
  register: registerAlias,
  listAliases: listAliases,
  shell: exec,
  shellSync: execSync,
};

export async function doctorAction(
  branch: string,
  fix: boolean,
  deps: Partial<DiagnosticoDeps> = {},
): Promise<void> {
  const {
    readEnv,
    hasMgr,
    volumeExists,
    volumeCreate,
    volumeCopy,
    register,
    listAliases,
    shell,
    shellSync,
  } = { ...defaultDeps, ...deps };

  const section = (title: string) => console.log(colors.bold(colors.info(`\n${title}`)));
  const withSpinner = async <T>(text: string, task: () => Promise<T>): Promise<T> => {
    if (!process.stdout.isTTY) {
      return task();
    }

    const loader = spinner(text).start();
    try {
      const result = await task();
      loader.succeed(text);
      return result;
    } catch (error) {
      loader.fail(text);
      throw error;
    }
  };

  console.log("");
  heading(`Diagnóstico: ${branch}`);
  await ensureWorkspaceBootstrap();
  if (fix) {
    console.log(`  ${colors.info("Modo correção ativo:")} problemas conhecidos serão corrigidos quando possível.`);
  }

  let issues = 0;
  let warnings = 0;
  let fixed = 0;

  const checkPass = (msg: string) => console.log(`  ${colors.ok("✓")} ${msg}`);
  const checkFail = (msg: string) => { console.log(`  ${colors.err("✗")} ${msg}`); issues++; };
  const checkWarn = (msg: string) => { console.log(`  ${colors.warn("⚠")} ${msg}`); warnings++; };
  const checkFix = (msg: string) => { console.log(`  ${colors.info("🔧")} ${msg}`); fixed++; };

  const wtDir = join(WORKTREES_DIR, branch);

  // 1. Worktree
  section("Worktree");
  if (pathExists(join(wtDir, ".workspace.env"))) {
    checkPass(`Diretório existe: ${wtDir}`);
  } else {
    checkFail(`Diretório não encontrado: ${wtDir}`);
    console.log(colors.warn(`\nBranch não existe. Crie com: ns new ${branch}`));
    process.exit(1);
  }

  // 2. .workspace.env
  section(".workspace.env");
  const env = await withSpinner("Lendo configuração da branch", () => readEnv(branch));
  if (env) {
    checkPass("Arquivo existe");
    const requiredVars = ["BRANCH_NAME", "BRANCH_SLUG", "DB_PORT", "BACKEND_PORT", "FRONTEND_PORT", "DB_VOLUME", "DB_CONTAINER", "COMPOSE_PROJECT"];
    for (const v of requiredVars) {
      const val = (env as any)[v];
      if (val) {
        checkPass(`${v}=${val}`);
      } else {
        checkFail(`${v} não definido ou vazio`);
      }
    }
    if (dirExists(join(wtDir, "manager"))) {
      if (env.MANAGER_PORT) {
        checkPass(`MANAGER_PORT=${env.MANAGER_PORT}`);
      } else {
        checkFail("MANAGER_PORT não definido (manager existe mas sem porta)");
      }
    }
  } else {
    checkFail("Arquivo .workspace.env não encontrado");
  }

  // 3. Backend
  section("Backend");
  const backendDir = join(wtDir, "backend");
  if (dirExists(backendDir)) {
    checkPass("Worktree existe");
    const props = join(backendDir, `${BACKEND_MODULE}-core/src/main/resources/application-dev.properties`);
    if (pathExists(props)) {
      checkPass("application-dev.properties existe");
    } else {
      checkFail("application-dev.properties não encontrado");
      if (fix && env) {
        const mkdirResult = await shell(["mkdir", "-p", join(props, "..")], { silent: true });
        assertSuccess(mkdirResult, `criar diretório ${join(props, "..")}`);
          await copyTemplate(
            join(WORKSPACE_DIR, "templates/backend-application-dev.properties"),
            props,
            {
              DB_PORT: String(env.DB_PORT),
              BACKEND_PORT: String(env.BACKEND_PORT),
              BRANCH_NAME: branch,
              BRANCH_SLUG: env.BRANCH_SLUG,
              PRODUCT_NAME,
              PORTLESS_PROXY_PORT: String(PORTLESS_PROXY_PORT),
              DB_USER: env.DB_USER,
              DB_PASSWORD: env.DB_PASSWORD,
              DB_NAME: env.DB_NAME,
            },
          );
        checkFix("Regenerado application-dev.properties");
      }
    }
  } else {
    checkFail("Worktree do backend não encontrado");
  }

  // 4. Frontend
  section("Frontend");
  const frontendDir = join(wtDir, "frontend");
  if (dirExists(frontendDir)) {
    checkPass("Worktree existe");
    const viteConfig = join(frontendDir, "vite.config.ts");
    if (pathExists(viteConfig)) {
      const viteContent = await Bun.file(viteConfig).text();
      if (viteContent.includes("loadEnv(mode, process.cwd()")) {
        checkPass("vite.config.ts usa loadEnv()");
      } else {
        checkFail("vite.config.ts NÃO usa loadEnv()");
      }
      if (viteContent.includes("mode === \"development\"") || viteContent.includes("mode === 'development'")) {
        checkPass("vite.config.ts separa config de development");
      } else {
        checkFail("vite.config.ts não separa config de development");
      }
      if (viteContent.includes("isDevelopmentDevServer") && viteContent.includes("portless-url")) {
        checkPass("plugin Portless limitado ao dev mode");
      } else {
        checkFail("plugin Portless não está limitado ao dev mode");
      }
      if (viteContent.includes("REACT_APP_FRONTEND_PORT")) {
        checkPass("vite.config.ts lê porta do ambiente");
      } else {
        checkFail("vite.config.ts não lê REACT_APP_FRONTEND_PORT");
      }
    } else {
      checkFail("vite.config.ts não encontrado");
    }
    const envLocal = join(frontendDir, ".env.local");
    if (pathExists(envLocal)) {
      checkPass(".env.local existe");
      const envContent = await Bun.file(envLocal).text();
      if (envContent.includes("REACT_APP_API_URL")) {
        checkPass(".env.local contém REACT_APP_API_URL");
      } else {
        checkFail(".env.local sem REACT_APP_API_URL");
      }
    } else {
      checkFail(".env.local não encontrado");
      if (fix && env) {
          await copyTemplate(
            join(WORKSPACE_DIR, "templates/frontend-.env.local"),
            envLocal,
            {
              BRANCH_NAME: branch,
              BRANCH_SLUG: env.BRANCH_SLUG,
              FRONTEND_PORT: String(env.FRONTEND_PORT),
              PRODUCT_NAME,
              PORTLESS_PROXY_PORT: String(PORTLESS_PROXY_PORT),
            },
          );
          checkFix("Regenerado .env.local");
        }
    }
  } else {
    checkFail("Worktree do frontend não encontrado");
  }

  // 5. Manager
  if (hasMgr(branch)) {
    section("Manager");
    const mgrVite = join(wtDir, "manager/vite.config.ts");
    if (pathExists(mgrVite)) {
      const content = await Bun.file(mgrVite).text();
      if (content.includes("loadEnv(mode, process.cwd")) {
        checkPass("vite.config.ts usa loadEnv()");
      } else {
        checkFail("vite.config.ts NÃO usa loadEnv()");
      }
      if (content.includes("mode === \"development\"") || content.includes("mode === 'development'")) {
        checkPass("vite.config.ts separa config de development");
      } else {
        checkFail("vite.config.ts não separa config de development");
      }
      if (content.includes("isDevelopmentDevServer") && content.includes("portless-url")) {
        checkPass("plugin Portless limitado ao dev mode");
      } else {
        checkFail("plugin Portless não está limitado ao dev mode");
      }
      if (content.includes("env.PORT")) {
        checkPass("vite.config.ts lê PORT do ambiente");
      } else {
        checkFail("vite.config.ts não lê PORT do ambiente");
      }
    } else {
      checkFail("vite.config.ts não encontrado");
    }
    const mgrEnv = join(wtDir, "manager/.env.local");
    if (pathExists(mgrEnv)) {
      checkPass(".env.local existe");
      const content = await Bun.file(mgrEnv).text();
      if (content.includes("VITE_BRANCH_NAME")) {
        checkPass(".env.local contém VITE_BRANCH_NAME");
      } else {
        checkFail(".env.local sem VITE_BRANCH_NAME");
        if (fix && env?.MANAGER_PORT) {
          await copyTemplate(
            join(WORKSPACE_DIR, "templates/manager-.env.local"),
            mgrEnv,
            {
              BRANCH_NAME: branch,
              BRANCH_SLUG: env.BRANCH_SLUG,
              MANAGER_PORT: String(env.MANAGER_PORT),
              PRODUCT_NAME,
              PORTLESS_PROXY_PORT: String(PORTLESS_PROXY_PORT),
            },
          );
          checkFix("Regenerado .env.local");
        }
      }
    } else {
      checkFail(".env.local não encontrado");
    }
  }

  // 6. Docker Volume
  section("Docker Volume");
  if (env?.DB_VOLUME) {
    if (await withSpinner(`Verificando volume Docker ${env.DB_VOLUME}`, () => volumeExists(env.DB_VOLUME))) {
      checkPass(`Volume existe: ${env.DB_VOLUME}`);
    } else {
      checkFail(`Volume NÃO existe: ${env.DB_VOLUME}`);
      if (fix) {
        const sourceVolume = SEED_VOLUME;
        if (await withSpinner(`Procurando volume base ${sourceVolume}`, () => volumeExists(sourceVolume))) {
          await withSpinner(`Criando volume ${env.DB_VOLUME}`, () => volumeCreate(env.DB_VOLUME));
          await withSpinner("Copiando dados do volume base", () => volumeCopy(sourceVolume, env.DB_VOLUME));
          checkFix("Volume criado e seedado do original");
        } else {
          await withSpinner(`Criando volume ${env.DB_VOLUME}`, () => volumeCreate(env.DB_VOLUME));
          checkFix("Volume criado vazio (source volume não encontrado)");
        }
      }
    }
  } else {
    checkFail("DB_VOLUME não definido em .workspace.env");
  }

  // 7. PostgreSQL Container
  section("PostgreSQL Container");
  if (env?.DB_CONTAINER) {
    const psResult = await withSpinner("Verificando containers Docker", () =>
      shell(["docker", "ps", "--format", "{{.Names}}"], { silent: true }),
    );
    assertSuccess(psResult, "listar containers Docker");
    if (psResult.stdout.split("\n").includes(env.DB_CONTAINER)) {
      checkPass(`Container rodando: ${env.DB_CONTAINER}`);
      const readyResult = await withSpinner("Testando resposta do PostgreSQL", () =>
        shell(
          ["docker", "exec", env.DB_CONTAINER, "pg_isready", "-U", env.DB_USER, "-d", env.DB_NAME],
          { silent: true },
        ),
      );
      if (readyResult.exitCode === 0) {
        checkPass("PostgreSQL está respondendo");
      } else {
        checkWarn("Container rodando mas PostgreSQL não responde ainda");
      }
    } else {
      checkWarn(`Container PARADO: ${env.DB_CONTAINER}`);
      console.log(colors.info(`    → Inicie com: ns prepare ${branch}`));
    }
  } else {
    checkFail("DB_CONTAINER não definido em .workspace.env");
  }

  // 8. Portless Aliases
  section("Portless Aliases");
  const aliases = await withSpinner("Carregando aliases portless", () => listAliases());
  const aliasSlug = env?.BRANCH_SLUG || branch.toLowerCase();
  const backendAlias = `${aliasSlug}.api.${PRODUCT_NAME}`;
  const frontendAlias = `${aliasSlug}.web.${PRODUCT_NAME}`;
  const managerAlias = `${aliasSlug}.manager.${PRODUCT_NAME}`;
  const hasAlias = (name: string) => aliases.some((a) => a.toLowerCase().includes(name.toLowerCase()));

  if (hasAlias(backendAlias)) {
    checkPass(`Alias backend: ${backendAlias}`);
  } else {
    checkFail("Alias backend NÃO registrado");
    if (fix && env?.BACKEND_PORT) {
      await register(backendAlias, env.BACKEND_PORT);
      checkFix("Alias backend registrado");
    }
  }
  if (hasAlias(frontendAlias)) {
    checkPass(`Alias frontend: ${frontendAlias}`);
  } else {
    checkFail("Alias frontend NÃO registrado");
    if (fix && env?.FRONTEND_PORT) {
      await register(frontendAlias, env.FRONTEND_PORT);
      checkFix("Alias frontend registrado");
    }
  }
  if (hasMgr(branch)) {
    if (hasAlias(managerAlias)) {
      checkPass(`Alias manager: ${managerAlias}`);
    } else {
      checkFail("Alias manager NÃO registrado");
      if (fix && env?.MANAGER_PORT) {
        await register(managerAlias, env.MANAGER_PORT);
        checkFix("Alias manager registrado");
      }
    }
  }

  // 9. Ports
  section("Portas");
  const ports = [env?.BACKEND_PORT, env?.FRONTEND_PORT];
  if (hasMgr(branch)) {
    ports.push(env?.MANAGER_PORT);
  }
  for (const port of ports) {
    if (port) {
      const result = shellSync(["lsof", "-Pi", `:${port}`, "-sTCP:LISTEN"], { silent: true });
      if (result.exitCode === 0) {
        checkWarn(`Porta ${port} está em uso`);
      } else if (result.stderr.trim()) {
        throw new Error(commandErrorMessage(`verificar porta ${port} com lsof`, result));
      } else {
        checkPass(`Porta ${port} disponível`);
      }
    }
  }

  // Summary
  console.log("");
  heading("Resumo");
  if (issues === 0 && warnings === 0) {
    console.log(`  ${colors.ok("✓ Tudo certo!")} Nenhum problema encontrado.`);
  } else if (issues === 0) {
    console.log(`  ${colors.warn("⚠")} ${warnings} aviso(s), nenhum erro crítico.`);
  } else {
    console.log(`  ${colors.err("✗")} ${issues} erro(s) encontrado(s), ${warnings} aviso(s).`);
  }
  if (fix && fixed > 0) {
    console.log(`  ${colors.info("🔧")} ${fixed} correção(ões) aplicada(s).`);
  }
  console.log("");

  if (issues > 0 && !fix) {
    console.log(colors.warn("Dica: Rode com --fix para tentar corrigir automaticamente:"));
    console.log(colors.bold(`  ns doctor ${branch} --fix`));
    console.log("");
  }
}
