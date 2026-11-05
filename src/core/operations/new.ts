import { join } from "path";
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
} from "../../lib/config";
import {
  branchExistsOnOrigin,
  fetchOrigin,
  createTrackingBranch,
  createLocalBranch,
  localBranchExists,
  createWorktree,
} from "../../lib/git";
import { allocatePorts } from "../../lib/ports";
import { copyTemplate } from "../../lib/templates";
import { dockerVolumeCreate, dockerVolumeCopy } from "../../lib/docker";
import { markBranchTouched } from "../../lib/branch-flags";
import { exec, execChecked } from "../../lib/shell";
import { ensureWorkspaceBootstrap } from "../../lib/bootstrap";
import { pathExistsAsync } from "../../lib/filesystem";
import { runHooks } from "../../lib/hooks";
import type { NsContext } from "../context";
import { NsError, type NsErrorCategory, asNsError, conflito, naoEncontrado, preCondicao } from "../errors";
import { type OptionalRepo, runAddRepo } from "./add-repo";
import { type PrepareInput, type PrepareResult, runPrepare } from "./prepare";

export interface NewInput {
  branch: string;
  baseBranch?: string;                                  // default: master; não vale para report-server e parents
  repos: OptionalRepo[];                                // Repos opcionais pedidos
  installMissingDeps: PrepareInput["installMissingDeps"];
}

/** Repo opcional que não entrou: a branch foi mantida e dá para incluí-lo de novo com `add`. */
export interface MissingRepo {
  repo: OptionalRepo;
  category: NsErrorCategory;
  message: string;
}

export interface NewResult {
  branch: string;
  slug: string;
  paths: { root: string; backend: string; frontend: string; docs: string; manager?: string; reportServer?: string; parents?: string };
  ports: { db: number; backend: number; management: number; frontend: number; manager?: number; reportServer?: number };
  urls: { frontend: string; backend: string; swagger: string; manager?: string; reportServer?: string };
  repos: OptionalRepo[];                                // Repos opcionais que a branch tem ao final
  missingRepos: MissingRepo[];
  prepared: PrepareResult;
}

export interface NewDeps {
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
  addRepo: typeof runAddRepo;
  prepare: typeof runPrepare;
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
  addRepo: runAddRepo,
  prepare: runPrepare,
};

/**
 * Nova Branch de workspace: cria a branch com backend, frontend, docs e o manager (se pedido),
 * inclui os outros Repos opcionais e prepara a branch, sem iniciar Serviços.
 * Repo opcional que falha depois de a branch existir não desfaz nada: vai para `missingRepos`.
 */
export async function runNew(
  input: NewInput,
  ctx: NsContext,
  overrides: Partial<NewDeps> = {},
): Promise<NewResult> {
  const deps = { ...defaultDeps, ...overrides };
  const { branch } = input;
  const requested = [...new Set(input.repos)];
  const withManager = requested.includes("manager");

  const created = await createBranch(branch, input.baseBranch ?? "master", withManager, ctx, deps);
  await deps.markTouched(branch, "new");

  const repos: OptionalRepo[] = withManager ? ["manager"] : [];
  const missingRepos: MissingRepo[] = [];
  for (const repo of requested.filter((repo) => repo !== "manager")) {
    ctx.emit({ step: `new:add:${repo}`, label: `Incluindo ${repo}...` });
    try {
      const added = await deps.addRepo({ branch, repo }, ctx);
      repos.push(repo);
      created.paths[repo === "parents" ? "parents" : "reportServer"] = added.path;
      if (added.port !== undefined) created.ports.reportServer = added.port;
    } catch (error) {
      const failure = asNsError(error);
      missingRepos.push({ repo, category: failure.category, message: failure.message });
    }
  }

  const prepared = await deps.prepare({ branch, installMissingDeps: input.installMissingDeps }, ctx).catch((error) => {
    const failure = asNsError(error);
    throw new NsError(failure.category, failure.message, {
      hint: `A branch foi criada. Para preparar de novo: ns prepare ${branch}`,
      cause: failure,
    });
  });
  if (prepared.urls.reportServer) created.urls.reportServer = prepared.urls.reportServer;
  return { ...created, repos, missingRepos, prepared };
}

type CreatedBranch = Pick<NewResult, "branch" | "slug" | "paths" | "ports" | "urls">;

async function createBranch(
  branch: string,
  baseBranch: string,
  withManager: boolean,
  ctx: NsContext,
  deps: NewDeps,
): Promise<CreatedBranch> {
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
    hooks,
  } = deps;

  const branchSlug = slugify(branch);
  const baseOriginBranch = baseBranch.replace(/^origin\//, "");
  const baseRef = `origin/${baseOriginBranch}`;
  const root = join(WORKTREES_DIR, branch);

  if (await pathExistsAsync(join(root, ".workspace.env"))) {
    throw conflito(`Worktree já existe: ${root}`, `Para recriar, remova antes com: ns rm ${branch}`);
  }

  ctx.emit({ step: "new:validate", label: "Validando repositórios..." });
  const required: Array<[string, string]> = [
    [BACKEND_REPO, "Backend"],
    [FRONTEND_REPO, "Frontend"],
    [DOCS_REPO, "Docs"],
    ...(withManager ? [[MANAGER_REPO, "Manager"] as [string, string]] : []),
  ];
  for (const [repo, name] of required) {
    if (!(await pathExistsAsync(join(repo, ".git")))) {
      throw preCondicao(`Repositório ${name} não encontrado em ${repo}`, "Confira NS_BASE_DIR com: ns doctor");
    }
  }

  try {
    // Base só no origin: a branch local pode ter sumido depois de um rm.
    for (const [repo, name] of required) {
      if (!(await branchExistsOrigin(repo, baseOriginBranch))) {
        throw naoEncontrado(`Branch base '${baseRef}' não existe ${name === "Manager" ? "no manager" : `em ${repo}`}`);
      }
    }

    await ensureWorkspaceBootstrap();

    const onOrigin = await Promise.all(required.map(([repo]) => branchExistsOrigin(repo, branch)));
    const useExisting = onOrigin.some(Boolean);

    for (const [repo, name] of required) {
      ctx.emit({ step: "new:repo", label: `Configurando ${name}...` });
      await fetch(repo);
      const hasRemote = await branchExistsOrigin(repo, branch);
      if (!localExists(repo, branch)) {
        if (useExisting && hasRemote) await trackBranch(repo, branch);
        else await localBranch(repo, branch, baseRef);
      }
      const wtPath = join(root, name.toLowerCase());
      await shell(["mkdir", "-p", join(wtPath, "..")], { silent: true });
      await worktree(repo, wtPath, branch);
    }

    ctx.emit({ step: "new:ports", label: "Alocando portas..." });
    const ports = allocate(withManager);
    const dbVolume = `${PRODUCT_NAME}_db_${branchSlug}`;
    const dbContainer = `${PRODUCT_NAME}-psql-${branchSlug}`;

    ctx.emit({ step: "new:templates", label: "Gerando arquivos de configuração..." });
    const workspaceEnv = join(root, ".workspace.env");
    await shell(["mkdir", "-p", root], { silent: true });
    await copyTpl(join(WORKSPACE_DIR, "templates/workspace.env"), workspaceEnv, {
      BRANCH_NAME: branch,
      BRANCH_SLUG: branchSlug,
      DB_PORT: String(ports.db),
      BACKEND_PORT: String(ports.backend),
      BACKEND_DEBUG_PORT: String(ports.backendDebug),
      MANAGEMENT_PORT: String(ports.management),
      FRONTEND_PORT: String(ports.frontend),
      MANAGER_PORT: ports.manager ? String(ports.manager) : "",
      DB_VOLUME: dbVolume,
      DB_CONTAINER: dbContainer,
      DB_USER,
      DB_PASSWORD,
      DB_NAME,
      COMPOSE_PROJECT: `ns-${branchSlug}`,
      CREATED_AT: new Date().toISOString(),
      SEEDED_FROM: baseOriginBranch,
    });

    const backendProps = join(root, `backend/${BACKEND_CORE_MODULE}/src/main/resources/application-dev.properties`);
    await shell(["mkdir", "-p", join(backendProps, "..")], { silent: true });
    await copyTpl(join(WORKSPACE_DIR, "templates/backend-application-dev.properties"), backendProps, {
      DB_PORT: String(ports.db),
      BACKEND_PORT: String(ports.backend),
      MANAGEMENT_PORT: String(ports.management),
      BRANCH_NAME: branch,
      BRANCH_SLUG: branchSlug,
      PRODUCT_NAME,
      PORTLESS_PROXY_PORT: String(PORTLESS_PROXY_PORT),
      DB_USER,
      DB_PASSWORD,
      DB_NAME,
    });

    await copyTpl(join(WORKSPACE_DIR, "templates/frontend-.env.local"), join(root, "frontend/.env.local"), {
      BRANCH_NAME: branch,
      BRANCH_SLUG: branchSlug,
      FRONTEND_PORT: String(ports.frontend),
      PRODUCT_NAME,
      PORTLESS_PROXY_PORT: String(PORTLESS_PROXY_PORT),
    });

    if (withManager) {
      await copyTpl(join(WORKSPACE_DIR, "templates/manager-.env.local"), join(root, "manager/.env.local"), {
        BRANCH_NAME: branch,
        BRANCH_SLUG: branchSlug,
        MANAGER_PORT: String(ports.manager!),
        PRODUCT_NAME,
        PORTLESS_PROXY_PORT: String(PORTLESS_PROXY_PORT),
      });
    }

    await Bun.write(join(root, "docker-compose.yml"), `services:
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
`);

    ctx.emit({ step: "new:ide", label: "Configurando IDE..." });
    const vscodeDir = join(root, ".vscode");
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

    const folders = required.map(([, name]) => ({ name: name.toLowerCase(), path: name.toLowerCase() }));
    await Bun.write(
      join(root, `${branch}.code-workspace`),
      JSON.stringify({ folders, settings: { "window.restoreWindows": "none", "workbench.startupEditor": "none" } }, null, 2),
    );

    const ideaDir = join(root, ".idea");
    await shell(["mkdir", "-p", ideaDir], { silent: true });
    await shell(["cp", join(WORKSPACE_DIR, "templates/idea/vcs.xml"), join(ideaDir, "vcs.xml")], { silent: true });
    for (const cfg of ["misc.xml", "compiler.xml", "encodings.xml", "jarRepositories.xml", "modules.xml", "neurosteps-workspace.iml"]) {
      if (await pathExistsAsync(join(WORKSPACE_DIR, `templates/idea/${cfg}`))) {
        await shell(["cp", join(WORKSPACE_DIR, `templates/idea/${cfg}`), join(ideaDir, cfg)], { silent: true });
      }
    }
    for (const dir of ["inspectionProfiles", "codeStyles", "scopes"]) {
      if (await pathExistsAsync(join(WORKSPACE_DIR, `templates/idea/${dir}`))) {
        await shell(["rm", "-rf", join(ideaDir, dir)], { silent: true });
        await shell(["cp", "-R", join(WORKSPACE_DIR, `templates/idea/${dir}`), join(ideaDir, dir)], { silent: true });
      }
    }

    const dsUuid = crypto.randomUUID();
    await copyTpl(join(WORKSPACE_DIR, "templates/idea/dataSources.xml"), join(ideaDir, "dataSources.xml"), {
      BRANCH_NAME: branch,
      DB_PORT: String(ports.db),
      DB_NAME,
      UUID: dsUuid,
    });

    // Equivale a "Add as Maven Project" no IntelliJ.
    if (await pathExistsAsync(join(WORKSPACE_DIR, "templates/idea/workspace.xml"))) {
      await copyTpl(join(WORKSPACE_DIR, "templates/idea/workspace.xml"), join(ideaDir, "workspace.xml"), {
        BACKEND_CORE_MODULE,
      });
    }

    ctx.emit({ step: "new:hooks", label: "Rodando hooks..." });
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

    const runDir = join(ideaDir, "runConfigurations");
    await shell(["mkdir", "-p", runDir], { silent: true });
    const rcResult = await shell(["ls", "-1", join(WORKSPACE_DIR, "templates/runConfigurations")], { silent: true });
    for (const rcName of rcResult.stdout.split("\n").filter((f) => f.endsWith(".xml"))) {
      await copyTpl(join(WORKSPACE_DIR, "templates/runConfigurations", rcName), join(runDir, rcName), {
        DB_PORT: String(ports.db),
        BACKEND_PORT: String(ports.backend),
        BACKEND_DEBUG_PORT: String(ports.backendDebug),
        MANAGEMENT_PORT: String(ports.management),
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
      });
    }

    const volumes = await shell(["docker", "volume", "ls", "-q"], { silent: true });
    if (volumes.stdout.split("\n").includes(SEED_VOLUME)) {
      ctx.emit({ step: "new:seed", label: "Seedando volume do banco..." });
      await volumeCreate(dbVolume);
      await volumeCopy(SEED_VOLUME, dbVolume);
      const envContent = await Bun.file(workspaceEnv).text();
      await Bun.write(workspaceEnv, envContent.replace(/^SEEDED_FROM=.*/m, `SEEDED_FROM="${SEED_VOLUME}"`));
    }

    const url = (app: string, path = "") => `https://${branchSlug}.${app}.${PRODUCT_NAME}.localhost:${PORTLESS_PROXY_PORT}${path}`;
    return {
      branch,
      slug: branchSlug,
      paths: {
        root,
        backend: join(root, "backend"),
        frontend: join(root, "frontend"),
        docs: join(root, "docs"),
        ...(withManager ? { manager: join(root, "manager") } : {}),
      },
      ports: {
        db: ports.db,
        backend: ports.backend,
        management: ports.management,
        frontend: ports.frontend,
        ...(ports.manager ? { manager: ports.manager } : {}),
      },
      urls: {
        frontend: url("web"),
        backend: url("api", "/api"),
        swagger: url("api", "/swagger-ui"),
        ...(withManager ? { manager: url("manager") } : {}),
      },
    };
  } catch (error) {
    throw asNsError(error);
  }
}
