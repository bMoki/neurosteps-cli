import {
  WORKSPACE_DIR,
  WORKTREES_DIR,
  PORTLESS_PROXY_PORT,
  PRODUCT_NAME,
  BACKEND_MODULE,
  BACKEND_CORE_MODULE,
  DB_USER,
  DB_PASSWORD,
  DB_NAME,
  SEED_VOLUME,
  BACKEND_REPO,
  FRONTEND_REPO,
  MANAGER_REPO,
  DOCS_REPO,
  slugify,
} from "../lib/config";
import {
  branchExistsOnOrigin,
  fetchOrigin,
  createTrackingBranch,
  createLocalBranch,
  localBranchExists,
  createWorktree,
} from "../lib/git";
import { allocatePorts } from "../lib/ports";
import { copyTemplate } from "../lib/templates";
import { dockerVolumeCreate, dockerVolumeCopy } from "../lib/docker";
import { detail, emptyLine, hint, section, spinner } from "../lib/logger";
import { markBranchTouched } from "../lib/branch-flags";
import { exec, execChecked } from "../lib/shell";
import { ensureWorkspaceBootstrap } from "../lib/bootstrap";
import { pathExistsAsync } from "../lib/filesystem";
import { runHooks } from "../lib/hooks";
import { join } from "path";

interface NewDeps {
  branchExistsOrigin: typeof branchExistsOnOrigin;
  fetch: typeof fetchOrigin;
  trackBranch: typeof createTrackingBranch;
  localBranch: typeof createLocalBranch;
  localExists: typeof localBranchExists;
  worktree: typeof createWorktree;
  allocate: typeof allocatePorts;
  copyTpl: typeof copyTemplate;
  volumeCreate: typeof dockerVolumeCreate;
  volumeCopy: typeof dockerVolumeCopy;
  shell: typeof exec;
  markTouched: typeof markBranchTouched;
  hooks: typeof runHooks;
}

const defaultDeps: NewDeps = {
  branchExistsOrigin: branchExistsOnOrigin,
  fetch: fetchOrigin,
  trackBranch: createTrackingBranch,
  localBranch: createLocalBranch,
  localExists: localBranchExists,
  worktree: createWorktree,
  allocate: allocatePorts,
  copyTpl: copyTemplate,
  volumeCreate: dockerVolumeCreate,
  volumeCopy: dockerVolumeCopy,
  shell: execChecked,
  markTouched: markBranchTouched,
  hooks: runHooks,
};

export async function newAction(
  branch: string,
  baseBranch: string,
  withManager: boolean,
  deps: Partial<NewDeps> = {},
): Promise<void> {
  const {
    branchExistsOrigin,
    fetch,
    trackBranch,
    localBranch,
    localExists,
    worktree,
    allocate,
    copyTpl,
    volumeCreate,
    volumeCopy,
    shell,
    markTouched,
    hooks,
  } = { ...defaultDeps, ...deps };

  const s = spinner(`Criando worktree da branch ${branch}...`).start();
  const branchSlug = slugify(branch);
  const baseOriginBranch = baseBranch.replace(/^origin\//, "");
  const baseRef = `origin/${baseOriginBranch}`;

  // Validate repos
  for (const [repo, name] of [
    [BACKEND_REPO, "Backend"],
    [FRONTEND_REPO, "Frontend"],
    [DOCS_REPO, "Docs"],
  ] as const) {
    if (!(await pathExistsAsync(join(repo, ".git")))) {
      s.stop();
      throw new Error(`Repositório ${name} não encontrado em ${repo}`);
    }
  }
  if (withManager) {
    if (!(await pathExistsAsync(join(MANAGER_REPO, ".git")))) {
      s.stop();
      throw new Error(`Repositório Manager não encontrado em ${MANAGER_REPO}`);
    }
  }

  // Validate base branch on origin. Local base branches may be absent after rm.
  for (const repo of [BACKEND_REPO, FRONTEND_REPO, DOCS_REPO]) {
    if (!(await branchExistsOrigin(repo, baseOriginBranch))) {
      s.stop();
      throw new Error(`Branch base '${baseRef}' não existe em ${repo}`);
    }
  }
  if (withManager && !(await branchExistsOrigin(MANAGER_REPO, baseOriginBranch))) {
    s.stop();
    throw new Error(`Branch base '${baseRef}' não existe no manager`);
  }

  await ensureWorkspaceBootstrap();

  // Check origin
  const originBackend = await branchExistsOrigin(BACKEND_REPO, branch);
  const originFrontend = await branchExistsOrigin(FRONTEND_REPO, branch);
  const originDocs = await branchExistsOrigin(DOCS_REPO, branch);
  const originManager = withManager ? await branchExistsOrigin(MANAGER_REPO, branch) : false;
  const useExisting = originBackend || originFrontend || originDocs || originManager;

  // Check worktree doesn't exist
  if (await pathExistsAsync(join(WORKTREES_DIR, branch, ".workspace.env"))) {
    s.stop();
    throw new Error(`Worktree já existe: ${WORKTREES_DIR}/${branch}`);
  }

  // Create branches + worktrees
  async function setupRepo(repo: string, name: string) {
    s.text = `Configurando ${name}...`;
    await fetch(repo);
    const hasRemote = await branchExistsOrigin(repo, branch);
    if (useExisting && hasRemote) {
      if (!localExists(repo, branch)) {
        await trackBranch(repo, branch);
      }
    } else {
      if (!localExists(repo, branch)) {
        await localBranch(repo, branch, baseRef);
      }
    }
    const wtPath = join(WORKTREES_DIR, branch, name.toLowerCase());
    await shell(["mkdir", "-p", join(wtPath, "..")], { silent: true });
    await worktree(repo, wtPath, branch);
  }

  await setupRepo(BACKEND_REPO, "Backend");
  await setupRepo(FRONTEND_REPO, "Frontend");
  await setupRepo(DOCS_REPO, "Docs");
  if (withManager) {
    await setupRepo(MANAGER_REPO, "Manager");
  }

  // Allocate ports
  const ports = allocate(withManager);

  const frontendWt = join(WORKTREES_DIR, branch, "frontend");

  const dbVolume = `${PRODUCT_NAME}_db_${branchSlug}`;
  const dbContainer = `${PRODUCT_NAME}-psql-${branchSlug}`;
  const composeProject = `ns-${branchSlug}`;

  // Generate workspace env
  const workspaceEnv = join(WORKTREES_DIR, branch, ".workspace.env");
  await shell(["mkdir", "-p", join(workspaceEnv, "..")], { silent: true });
  await copyTpl(join(WORKSPACE_DIR, "templates/workspace.env"), workspaceEnv, {
    BRANCH_NAME: branch,
    BRANCH_SLUG: branchSlug,
    DB_PORT: String(ports.db),
    BACKEND_PORT: String(ports.backend),
    BACKEND_DEBUG_PORT: String(ports.backendDebug),
    FRONTEND_PORT: String(ports.frontend),
    MANAGER_PORT: ports.manager ? String(ports.manager) : "",
    DB_VOLUME: dbVolume,
    DB_CONTAINER: dbContainer,
    DB_USER,
    DB_PASSWORD,
    DB_NAME,
    COMPOSE_PROJECT: composeProject,
    CREATED_AT: new Date().toISOString(),
    SEEDED_FROM: baseOriginBranch,
  });

  // Copy templates
  const backendProps = join(WORKTREES_DIR, branch, `backend/${BACKEND_CORE_MODULE}/src/main/resources/application-dev.properties`);
  await shell(["mkdir", "-p", join(backendProps, "..")], { silent: true });
  await copyTpl(join(WORKSPACE_DIR, "templates/backend-application-dev.properties"), backendProps, {
    DB_PORT: String(ports.db),
    BACKEND_PORT: String(ports.backend),
    BRANCH_NAME: branch,
    BRANCH_SLUG: branchSlug,
    PRODUCT_NAME,
    PORTLESS_PROXY_PORT: String(PORTLESS_PROXY_PORT),
    DB_USER,
    DB_PASSWORD,
    DB_NAME,
  });

  await copyTpl(join(WORKSPACE_DIR, "templates/frontend-.env.local"), join(frontendWt, ".env.local"), {
    BRANCH_NAME: branch,
    BRANCH_SLUG: branchSlug,
    FRONTEND_PORT: String(ports.frontend),
    PRODUCT_NAME,
    PORTLESS_PROXY_PORT: String(PORTLESS_PROXY_PORT),
  });

  if (withManager) {
    await copyTpl(join(WORKSPACE_DIR, "templates/manager-.env.local"), join(WORKTREES_DIR, branch, "manager/.env.local"), {
      BRANCH_NAME: branch,
      BRANCH_SLUG: branchSlug,
      MANAGER_PORT: String(ports.manager!),
      PRODUCT_NAME,
      PORTLESS_PROXY_PORT: String(PORTLESS_PROXY_PORT),
    });
  }

  // Generate docker-compose.yml
  const composeContent = `services:
  db:
    image: bitnami/postgresql:latest
    container_name: ${dbContainer}
    ports:
      - "${ports.db}:5432"
    environment:
      - POSTGRESQL_USERNAME=${DB_USER}
      - POSTGRESQL_PASSWORD=${DB_PASSWORD}
      - POSTGRESQL_DATABASE=${DB_NAME}
    volumes:
      - ${dbVolume}:/bitnami/postgresql

volumes:
  ${dbVolume}:
    name: ${dbVolume}
`;
  await Bun.write(join(WORKTREES_DIR, branch, "docker-compose.yml"), composeContent);

  // Setup VS Code workspace
  const vscodeDir = join(WORKTREES_DIR, branch, ".vscode");
  await shell(["mkdir", "-p", vscodeDir], { silent: true });
  await copyTpl(join(WORKSPACE_DIR, "templates/vscode/settings.json"), join(vscodeDir, "settings.json"), {
    DB_PORT: String(ports.db),
    BRANCH_NAME: branch,
  });
  await copyTpl(join(WORKSPACE_DIR, "templates/vscode/tasks.json"), join(vscodeDir, "tasks.json"), {
    DB_PORT: String(ports.db),
    BACKEND_PORT: String(ports.backend),
    FRONTEND_PORT: String(ports.frontend),
    MANAGER_PORT: ports.manager ? String(ports.manager) : "",
    BRANCH_NAME: branch,
  });
  await copyTpl(join(WORKSPACE_DIR, "templates/vscode/launch.json"), join(vscodeDir, "launch.json"), {
    BRANCH_NAME: branch,
  });
  await shell(["cp", join(WORKSPACE_DIR, "templates/vscode/extensions.json"), join(vscodeDir, "extensions.json")], { silent: true });

  // Multi-root workspace
  const folders = [
    { name: "backend", path: "backend" },
    { name: "frontend", path: "frontend" },
    { name: "docs", path: "docs" },
  ];
  if (withManager) {
    folders.push({ name: "manager", path: "manager" });
  }
  await Bun.write(
    join(WORKTREES_DIR, branch, `${branch}.code-workspace`),
    JSON.stringify({ folders, settings: { "window.restoreWindows": "none", "workbench.startupEditor": "none" } }, null, 2),
  );

  // Setup IntelliJ
  const ideaDir = join(WORKTREES_DIR, branch, ".idea");
  await shell(["mkdir", "-p", ideaDir], { silent: true });
  await shell(["cp", join(WORKSPACE_DIR, "templates/idea/vcs.xml"), join(ideaDir, "vcs.xml")], { silent: true });
  if (await pathExistsAsync(join(WORKSPACE_DIR, "templates/idea/misc.xml"))) {
    await shell(["cp", join(WORKSPACE_DIR, "templates/idea/misc.xml"), join(ideaDir, "misc.xml")], { silent: true });
  }
  for (const cfg of ["compiler.xml", "encodings.xml", "jarRepositories.xml", "modules.xml"]) {
    if (await pathExistsAsync(join(WORKSPACE_DIR, `templates/idea/${cfg}`))) {
      await shell(["cp", join(WORKSPACE_DIR, `templates/idea/${cfg}`), join(ideaDir, cfg)], { silent: true });
    }
  }
  if (await pathExistsAsync(join(WORKSPACE_DIR, "templates/idea/neurosteps-workspace.iml"))) {
    await shell(["cp", join(WORKSPACE_DIR, "templates/idea/neurosteps-workspace.iml"), join(ideaDir, "neurosteps-workspace.iml")], { silent: true });
  }
  for (const dir of ["inspectionProfiles", "codeStyles", "scopes"]) {
    if (await pathExistsAsync(join(WORKSPACE_DIR, `templates/idea/${dir}`))) {
      await shell(["rm", "-rf", join(ideaDir, dir)], { silent: true });
      await shell(["cp", "-R", join(WORKSPACE_DIR, `templates/idea/${dir}`), join(ideaDir, dir)], { silent: true });
    }
  }

  // DataGrip datasource
  const dsUuid = crypto.randomUUID();
  await copyTpl(join(WORKSPACE_DIR, "templates/idea/dataSources.xml"), join(ideaDir, "dataSources.xml"), {
    BRANCH_NAME: branch,
    DB_PORT: String(ports.db),
    DB_NAME,
    UUID: dsUuid,
  });

  // Maven project registration (equivalent to "Add as Maven Project" in IntelliJ)
  if (await pathExistsAsync(join(WORKSPACE_DIR, "templates/idea/workspace.xml"))) {
    await copyTpl(join(WORKSPACE_DIR, "templates/idea/workspace.xml"), join(ideaDir, "workspace.xml"), {
      BACKEND_CORE_MODULE,
    });
  }

  await hooks("new:after", {
    branch,
    ideaDir,
    productName: PRODUCT_NAME,
    dataSourceUuid: dsUuid,
    dbPort: ports.db,
    dbUser: DB_USER,
    dbName: DB_NAME,
    dbSchema: "core",
    repos: folders,
  });

  // Run configurations
  const runDir = join(ideaDir, "runConfigurations");
  await shell(["mkdir", "-p", runDir], { silent: true });
  const rcResult = await shell(["ls", "-1", join(WORKSPACE_DIR, "templates/runConfigurations")], { silent: true });
  for (const rcName of rcResult.stdout.split("\n").filter((f) => f.endsWith(".xml"))) {
    await copyTpl(
      join(WORKSPACE_DIR, "templates/runConfigurations", rcName),
      join(runDir, rcName),
      {
        DB_PORT: String(ports.db),
        BACKEND_PORT: String(ports.backend),
        BACKEND_DEBUG_PORT: String(ports.backendDebug),
        FRONTEND_PORT: String(ports.frontend),
        MANAGER_PORT: ports.manager ? String(ports.manager) : "",
        BRANCH_NAME: branch,
        BRANCH_SLUG: branchSlug,
        BACKEND_MODULE,
        PRODUCT_NAME,
        PORTLESS_PROXY_PORT: String(PORTLESS_PROXY_PORT),
        DB_USER,
        DB_PASSWORD,
        DB_NAME,
      },
    );
  }

  // Seed database
  const sourceVolume = SEED_VOLUME;
  if (await shell(["docker", "volume", "ls", "-q"], { silent: true }).then((r) => r.stdout.split("\n").includes(sourceVolume))) {
    s.text = "Seedando volume do banco...";
    await volumeCreate(dbVolume);
    await volumeCopy(sourceVolume, dbVolume);
    // Update SEEDED_FROM
    let envContent = await Bun.file(workspaceEnv).text();
    envContent = envContent.replace(/^SEEDED_FROM=.*/m, `SEEDED_FROM="${sourceVolume}"`);
    await Bun.write(workspaceEnv, envContent);
  }

  s.succeed(`Worktree '${branch}' criada`);
  await markTouched(branch, "new");

  // Summary
  emptyLine();
  section("Paths");
  detail("Backend", `${WORKTREES_DIR}/${branch}/backend`);
  detail("Frontend", `${WORKTREES_DIR}/${branch}/frontend`);
  detail("Docs", `${WORKTREES_DIR}/${branch}/docs`);
  if (withManager) {
    detail("Manager", `${WORKTREES_DIR}/${branch}/manager`);
  }
  section("Portas");
  detail("Database", `localhost:${ports.db}`);
  detail("Backend", `localhost:${ports.backend}`);
  detail("Frontend", `localhost:${ports.frontend}`);
  if (withManager) {
    detail("Manager", `localhost:${ports.manager}`);
  }
  section("URLs");
  detail("Frontend", `https://${branchSlug}.web.${PRODUCT_NAME}.localhost:${PORTLESS_PROXY_PORT}`);
  detail("Backend", `https://${branchSlug}.api.${PRODUCT_NAME}.localhost:${PORTLESS_PROXY_PORT}/api`);
  detail("Swagger", `https://${branchSlug}.api.${PRODUCT_NAME}.localhost:${PORTLESS_PROXY_PORT}/swagger-ui`);
  if (withManager) {
    detail("Manager", `https://${branchSlug}.manager.${PRODUCT_NAME}.localhost:${PORTLESS_PROXY_PORT}`);
  }
  section("Próximos passos");
  hint(`  1. ns prepare ${branch}    # DB + aliases Portless`);
  hint(`  2. ns open ${branch}       # abrir no IDE`);
  hint("  3. Rode as tasks de Backend/Frontend no IDE");
}
