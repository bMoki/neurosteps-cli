import { describe, expect, mock, test } from "bun:test";
import { addDocsAction, addManagerAction } from "../../actions/add";
import { createShellResult } from "../setup";

class ProcessExit extends Error {}

describe("addManagerAction", () => {
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
    allocateManagerPort: mock(() => 3020),
    shell: mock((command: string[]) => Promise.resolve(createShellResult(command))),
    exists: mock((path: string) => path.endsWith(".workspace.env") || path.endsWith(".git")),
    ensureBootstrap: mock(() => Promise.resolve({ createdDirs: [], installedTemplates: [], updatedTemplates: [], preservedTemplates: [] })),
    copyTpl: mock(() => Promise.resolve()),
    readText: mock(() => Promise.resolve('BRANCH_NAME="NS-927"\nBRANCH_SLUG="ns-927"\n')),
    writeText: mock(() => Promise.resolve()),
  });

  test("adds manager worktree and writes manager config", async () => {
    const deps = createDeps();

    await addManagerAction("NS-927", {}, deps);

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

    await addManagerAction("NS-927", {}, deps);

    expect(deps.trackBranch).toHaveBeenCalledWith(expect.any(String), "NS-927");
    expect(deps.localBranch).not.toHaveBeenCalled();
  });

  test("creates manager branch from requested origin base", async () => {
    const deps = createDeps();
    deps.branchExistsOrigin = mock((repo: string, branch: string) => Promise.resolve(branch === "develop"));

    await addManagerAction("NS-927", { base: "develop" }, deps);

    expect(deps.localBranch).toHaveBeenCalledWith(expect.any(String), "NS-927", "origin/develop");
  });

  test("uses requested manager port", async () => {
    const deps = createDeps();

    await addManagerAction("NS-927", { port: "3033" }, deps);

    expect(deps.allocateManagerPort).not.toHaveBeenCalled();
    expect(deps.writeText).toHaveBeenCalledWith(expect.any(String), expect.stringContaining('MANAGER_PORT="3033"'));
  });

  test("exits when manager already exists", async () => {
    const deps = createDeps();
    deps.exists = mock((path: string) => path.endsWith(".workspace.env") || path.endsWith(".git") || path.endsWith("/manager"));
    const originalExit = process.exit;
    process.exit = ((code: number) => { throw new ProcessExit(String(code)); }) as any;

    try {
      await addManagerAction("NS-927", {}, deps);
      expect(false).toBe(true);
    } catch (e) {
      expect(e).toBeInstanceOf(ProcessExit);
    } finally {
      process.exit = originalExit;
    }
  });
});

describe("addDocsAction", () => {
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
  });

  async function withWorkspaceFile(run: (write: ReturnType<typeof mock>) => Promise<void>): Promise<void> {
    const originalFile = Bun.file;
    const originalWrite = Bun.write;
    const write = mock(() => Promise.resolve(0));
    Bun.file = mock((path: string) => ({
      exists: () => Promise.resolve(path.endsWith(".workspace.env") || path.endsWith(".git") || path.endsWith(".code-workspace")),
      text: () => Promise.resolve('{"folders":[{"name":"backend","path":"backend"}]}'),
    })) as any;
    Bun.write = write as any;
    try {
      await run(write);
    } finally {
      Bun.file = originalFile;
      Bun.write = originalWrite;
    }
  }

  test("adds docs worktree and updates code workspace", async () => {
    const deps = createDeps();

    await withWorkspaceFile(async (write) => {
      await addDocsAction("NS-927", {}, deps);

      expect(deps.fetch).toHaveBeenCalled();
      expect(deps.localBranch).toHaveBeenCalledWith(expect.any(String), "NS-927", "origin/master");
      expect(deps.worktree).toHaveBeenCalledWith(expect.any(String), expect.stringContaining("/NS-927/docs"), "NS-927");
      expect(write).toHaveBeenCalledWith(expect.stringContaining("NS-927.code-workspace"), expect.stringContaining('"path": "docs"'));
    });
  });

  test("tracks remote docs branch when it exists", async () => {
    const deps = createDeps();
    deps.branchExistsOrigin = mock(() => Promise.resolve(true));
    deps.localExists = mock((repo: string, branch: string): boolean => false);

    await withWorkspaceFile(async () => {
      await addDocsAction("NS-927", {}, deps);

      expect(deps.trackBranch).toHaveBeenCalledWith(expect.any(String), "NS-927");
      expect(deps.localBranch).not.toHaveBeenCalled();
    });
  });

  test("exits when docs already exists", async () => {
    const deps = createDeps();
    deps.exists = mock((path: string) => path.endsWith(".workspace.env") || path.endsWith(".git") || path.endsWith("/docs"));
    const originalExit = process.exit;
    process.exit = ((code: number) => { throw new ProcessExit(String(code)); }) as any;

    try {
      await addDocsAction("NS-927", {}, deps);
      expect(false).toBe(true);
    } catch (e) {
      expect(e).toBeInstanceOf(ProcessExit);
    } finally {
      process.exit = originalExit;
    }
  });
});
