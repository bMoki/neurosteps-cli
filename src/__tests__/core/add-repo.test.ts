import { describe, expect, mock, test } from "bun:test";
import { createSilentContext, runAddRepo } from "../../core";
import { createShellResult } from "../setup";

describe("runAddRepo manager", () => {
  const createDeps = () => ({
    readEnv: mock(() => Promise.resolve({
      BRANCH_NAME: "NS-927",
      BRANCH_SLUG: "ns-927",
      DB_PORT: 5437,
      BACKEND_PORT: 8083,
      FRONTEND_PORT: 3014,
      DB_VOLUME: "neurosteps_db_ns-927",
      DB_CONTAINER: "neurosteps-psql-ns-927",
      COMPOSE_PROJECT: "ns-ns-927",
      DB_USER: "postgres",
      DB_PASSWORD: "docker",
      DB_NAME: "app_database",
    })),
    fetch: mock(() => Promise.resolve()),
    branchExistsOrigin: mock((repo: string, branch: string) => Promise.resolve(branch === "master")),
    localExists: mock((repo: string, branch: string): boolean => branch === "master"),
    trackBranch: mock(() => Promise.resolve()),
    localBranch: mock(() => Promise.resolve()),
    worktree: mock(() => Promise.resolve()),
    allocatePort: mock(() => 3020),
    shell: mock((command: string[]) => Promise.resolve(createShellResult(command))),
    exists: mock((path: string) => path.endsWith(".workspace.env") || path.endsWith(".git")),
    ensureBootstrap: mock(() => Promise.resolve({ createdDirs: [], installedTemplates: [], updatedTemplates: [], preservedTemplates: [] })),
    copyTpl: mock(() => Promise.resolve()),
    readText: mock(() => Promise.resolve('BRANCH_NAME="NS-927"\nBRANCH_SLUG="ns-927"\n')),
    writeText: mock(() => Promise.resolve()),
  });

  test("adds manager worktree and writes manager config", async () => {
    const deps = createDeps();

    await runAddRepo({ branch: "NS-927", repo: "manager" }, createSilentContext(), deps);

    expect(deps.fetch).toHaveBeenCalled();
    expect(deps.localBranch).toHaveBeenCalledWith(expect.any(String), "NS-927", "origin/master");
    expect(deps.worktree).toHaveBeenCalledWith(expect.any(String), expect.stringContaining("/NS-927/manager"), "NS-927");
    expect(deps.writeText).toHaveBeenCalledWith(expect.stringContaining(".workspace.env"), expect.stringContaining('MANAGER_PORT="3020"'));
    expect(deps.copyTpl).toHaveBeenCalledWith(
      expect.stringContaining("manager-.env.local"),
      expect.stringContaining("/NS-927/manager/.env.local"),
      expect.objectContaining({ BRANCH_SLUG: "ns-927", MANAGER_PORT: "3020" }),
    );
  });

  test("tracks remote manager branch when it exists", async () => {
    const deps = createDeps();
    deps.branchExistsOrigin = mock(() => Promise.resolve(true));
    deps.localExists = mock((repo: string, branch: string): boolean => false);

    await runAddRepo({ branch: "NS-927", repo: "manager" }, createSilentContext(), deps);

    expect(deps.trackBranch).toHaveBeenCalledWith(expect.any(String), "NS-927");
    expect(deps.localBranch).not.toHaveBeenCalled();
  });

  test("creates manager branch from requested origin base", async () => {
    const deps = createDeps();
    deps.branchExistsOrigin = mock((repo: string, branch: string) => Promise.resolve(branch === "develop"));

    await runAddRepo({ branch: "NS-927", repo: "manager", base: "develop" }, createSilentContext(), deps);

    expect(deps.localBranch).toHaveBeenCalledWith(expect.any(String), "NS-927", "origin/develop");
  });

  test("uses requested manager port", async () => {
    const deps = createDeps();

    await runAddRepo({ branch: "NS-927", repo: "manager", port: 3033 }, createSilentContext(), deps);

    expect(deps.allocatePort).not.toHaveBeenCalled();
    expect(deps.writeText).toHaveBeenCalledWith(expect.any(String), expect.stringContaining('MANAGER_PORT="3033"'));
  });

  test("fails with conflito when manager already exists", async () => {
    const deps = createDeps();
    deps.exists = mock((path: string) => path.endsWith(".workspace.env") || path.endsWith(".git") || path.endsWith("/manager"));

    await expect(runAddRepo({ branch: "NS-927", repo: "manager" }, createSilentContext(), deps)).rejects.toMatchObject({ category: "conflito" });
    expect(deps.worktree).not.toHaveBeenCalled();
  });
});

describe("runAddRepo docs", () => {
  const createDeps = () => ({
    readEnv: mock(() => Promise.resolve({
      BRANCH_NAME: "NS-927",
      BRANCH_SLUG: "ns-927",
      DB_PORT: 5437,
      BACKEND_PORT: 8083,
      FRONTEND_PORT: 3014,
      DB_VOLUME: "neurosteps_db_ns-927",
      DB_CONTAINER: "neurosteps-psql-ns-927",
      COMPOSE_PROJECT: "ns-ns-927",
      DB_USER: "postgres",
      DB_PASSWORD: "docker",
      DB_NAME: "app_database",
    })),
    fetch: mock(() => Promise.resolve()),
    branchExistsOrigin: mock((repo: string, branch: string) => Promise.resolve(branch === "master")),
    localExists: mock((repo: string, branch: string): boolean => branch === "master"),
    trackBranch: mock(() => Promise.resolve()),
    localBranch: mock(() => Promise.resolve()),
    worktree: mock(() => Promise.resolve()),
    shell: mock((command: string[]) => Promise.resolve(createShellResult(command))),
    exists: mock((path: string) => path.endsWith(".workspace.env") || path.endsWith(".git") || path.endsWith(".code-workspace")),
    ensureBootstrap: mock(() => Promise.resolve({ createdDirs: [], installedTemplates: [], updatedTemplates: [], preservedTemplates: [] })),
    readText: mock(() => Promise.resolve('{"folders":[{"name":"backend","path":"backend"}]}')),
    writeText: mock(() => Promise.resolve()),
  });

  test("adds docs worktree and updates code workspace", async () => {
    const deps = createDeps();

    await runAddRepo({ branch: "NS-927", repo: "docs" }, createSilentContext(), deps);

    expect(deps.fetch).toHaveBeenCalled();
    expect(deps.localBranch).toHaveBeenCalledWith(expect.any(String), "NS-927", "origin/master");
    expect(deps.worktree).toHaveBeenCalledWith(expect.any(String), expect.stringContaining("/NS-927/docs"), "NS-927");
    expect(deps.writeText).toHaveBeenCalledWith(expect.stringContaining("NS-927.code-workspace"), expect.stringContaining('"path": "docs"'));
  });

  test("tracks remote docs branch when it exists", async () => {
    const deps = createDeps();
    deps.branchExistsOrigin = mock(() => Promise.resolve(true));
    deps.localExists = mock((repo: string, branch: string): boolean => false);

    await runAddRepo({ branch: "NS-927", repo: "docs" }, createSilentContext(), deps);

    expect(deps.trackBranch).toHaveBeenCalledWith(expect.any(String), "NS-927");
    expect(deps.localBranch).not.toHaveBeenCalled();
  });

  test("fails with conflito when docs already exists", async () => {
    const deps = createDeps();
    deps.exists = mock((path: string) => path.endsWith(".workspace.env") || path.endsWith(".git") || path.endsWith("/docs"));

    await expect(runAddRepo({ branch: "NS-927", repo: "docs" }, createSilentContext(), deps)).rejects.toMatchObject({ category: "conflito" });
    expect(deps.worktree).not.toHaveBeenCalled();
  });
});

describe("runAddRepo parents", () => {
  const createDeps = () => ({
    readEnv: mock(() => Promise.resolve({
      BRANCH_NAME: "NS-927",
      BRANCH_SLUG: "ns-927",
      DB_PORT: 5437,
      BACKEND_PORT: 8083,
      FRONTEND_PORT: 3014,
      DB_VOLUME: "neurosteps_db_ns-927",
      DB_CONTAINER: "neurosteps-psql-ns-927",
      COMPOSE_PROJECT: "ns-ns-927",
      DB_USER: "postgres",
      DB_PASSWORD: "docker",
      DB_NAME: "app_database",
    })),
    fetch: mock(() => Promise.resolve()),
    branchExistsOrigin: mock((repo: string, branch: string) => Promise.resolve(branch === "main")),
    localExists: mock((repo: string, branch: string): boolean => branch === "main"),
    trackBranch: mock(() => Promise.resolve()),
    localBranch: mock(() => Promise.resolve()),
    worktree: mock(() => Promise.resolve()),
    shell: mock((command: string[]) => Promise.resolve(createShellResult(command))),
    exists: mock((path: string) => path.endsWith(".workspace.env") || path.endsWith(".git") || path.endsWith(".code-workspace")),
    ensureBootstrap: mock(() => Promise.resolve({ createdDirs: [], installedTemplates: [], updatedTemplates: [], preservedTemplates: [] })),
    readText: mock(() => Promise.resolve('{"folders":[{"name":"backend","path":"backend"}]}')),
    writeText: mock(() => Promise.resolve()),
  });

  test("adds parents worktree and updates code workspace", async () => {
    const deps = createDeps();

    await runAddRepo({ branch: "NS-927", repo: "parents" }, createSilentContext(), deps);

    expect(deps.fetch).toHaveBeenCalled();
    expect(deps.localBranch).toHaveBeenCalledWith(expect.any(String), "NS-927", "origin/main");
    expect(deps.worktree).toHaveBeenCalledWith(expect.any(String), expect.stringContaining("/NS-927/parents"), "NS-927");
    expect(deps.writeText).toHaveBeenCalledWith(expect.stringContaining("NS-927.code-workspace"), expect.stringContaining('"path": "parents"'));
  });

  test("tracks remote parents branch when it exists", async () => {
    const deps = createDeps();
    deps.branchExistsOrigin = mock(() => Promise.resolve(true));
    deps.localExists = mock((repo: string, branch: string): boolean => false);

    await runAddRepo({ branch: "NS-927", repo: "parents" }, createSilentContext(), deps);

    expect(deps.trackBranch).toHaveBeenCalledWith(expect.any(String), "NS-927");
    expect(deps.localBranch).not.toHaveBeenCalled();
  });

  test("fails with conflito when parents already exists", async () => {
    const deps = createDeps();
    deps.exists = mock((path: string) => path.endsWith(".workspace.env") || path.endsWith(".git") || path.endsWith("/parents"));

    await expect(runAddRepo({ branch: "NS-927", repo: "parents" }, createSilentContext(), deps)).rejects.toMatchObject({ category: "conflito" });
    expect(deps.worktree).not.toHaveBeenCalled();
  });


  test("fails with nao-encontrado when the workspace branch does not exist", async () => {
    const deps = createDeps();
    deps.readEnv = mock(() => Promise.resolve(null)) as any;

    await expect(runAddRepo({ branch: "NS-927", repo: "parents" }, createSilentContext(), deps))
      .rejects.toMatchObject({ category: "nao-encontrado", message: "Worktree 'NS-927' não encontrada" });
  });

  test("fails with pre-condicao when the repo is not cloned", async () => {
    const deps = createDeps();
    deps.exists = mock((path: string) => path.endsWith(".workspace.env"));

    await expect(runAddRepo({ branch: "NS-927", repo: "parents" }, createSilentContext(), deps))
      .rejects.toMatchObject({ category: "pre-condicao" });
  });

  test("fails with nao-encontrado when the base is missing, and a retry works once it exists", async () => {
    const deps = createDeps();
    let baseExists = false;
    deps.branchExistsOrigin = mock((repo: string, branch: string) => Promise.resolve(baseExists && branch === "main"));

    await expect(runAddRepo({ branch: "NS-927", repo: "parents" }, createSilentContext(), deps))
      .rejects.toMatchObject({ category: "nao-encontrado", message: "Branch base 'origin/main' não existe no parents" });
    expect(deps.worktree).not.toHaveBeenCalled();

    baseExists = true;
    const result = await runAddRepo({ branch: "NS-927", repo: "parents" }, createSilentContext(), deps);

    expect(result.path).toEndWith("/NS-927/parents");
    expect(deps.worktree).toHaveBeenCalledTimes(1);
  });

  test("reports a failing git as ferramenta-externa", async () => {
    const deps = createDeps();
    deps.fetch = mock(() => Promise.reject(new Error("fatal: unable to access remote")));

    await expect(runAddRepo({ branch: "NS-927", repo: "parents" }, createSilentContext(), deps))
      .rejects.toMatchObject({ category: "ferramenta-externa", message: "fatal: unable to access remote" });
  });

  test("undoes the worktree when a later step fails, so a retry is not a conflict", async () => {
    const deps = { ...createDeps(), removeWorktree: mock(() => Promise.resolve()) };
    deps.writeText = mock(() => Promise.reject(new Error("EACCES: permission denied")));

    await expect(runAddRepo({ branch: "NS-927", repo: "parents" }, createSilentContext(), deps))
      .rejects.toMatchObject({ category: "ferramenta-externa", message: "EACCES: permission denied" });

    expect(deps.removeWorktree).toHaveBeenCalledWith(expect.any(String), expect.stringContaining("/NS-927/parents"), { force: true });
  });
});
