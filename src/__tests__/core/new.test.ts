import { describe, test, expect, mock } from "bun:test";
import { type AddRepoInput, type NsContext, type NsProgressEvent, type OptionalRepo, type SetNicknameInput, createSilentContext, naoEncontrado, runNew } from "../../core";
import { createShellResult } from "../setup";

const prepared = {
  branch: "feat-123",
  ports: { db: 5438, backend: 8084, frontend: 3015 },
  urls: { backend: "", frontend: "" },
  services: [],
  depsInstalled: [],
  depsMissing: [],
};

describe("runNew", () => {
  const createMocks = () => ({
    branchExistsOrigin: mock((repo: string, branch: string) => Promise.resolve(branch === "master")),
    fetch: mock((repo: string) => Promise.resolve()),
    trackBranch: mock((repo: string, branch: string) => Promise.resolve()),
    localBranch: mock((repo: string, branch: string, base: string) => Promise.resolve()),
    localExists: mock((repo: string, branch: string) => true),
    worktree: mock((repo: string, path: string, branch: string) => Promise.resolve()),
    allocate: mock((withManager?: boolean) => ({ db: 5438, backend: 8084, backendDebug: 5005, management: 9001, frontend: 3015 })),
    copyTpl: mock((src: string, dst: string, variables: Record<string, string>) => Promise.resolve()),
    volumeCreate: mock((name: string) => Promise.resolve()),
    volumeCopy: mock((source: string, target: string) => Promise.resolve()),
    shell: mock((cmd: string[]) => Promise.resolve(createShellResult(cmd))),
    markTouched: mock(() => Promise.resolve()),
    hooks: mock(() => Promise.resolve()),
    addRepo: mock((input: AddRepoInput, _ctx: NsContext) => Promise.resolve({ branch: input.branch, repo: input.repo, path: "" })),
    prepare: mock(() => Promise.resolve(prepared)),
    setNickname: mock((input: SetNicknameInput, _ctx: NsContext) => Promise.resolve({ branch: input.branch, nickname: input.nickname })),
  });

  const run = (mocks: ReturnType<typeof createMocks>, repos: OptionalRepo[] = [], baseBranch = "master") =>
    runNew({ branch: "feat-123", baseBranch, repos, installMissingDeps: "never" }, createSilentContext(), mocks);

  test("creates new branch without manager", async () => {
    const mocks = createMocks();
    mocks.shell = mock((cmd: string[]) => {
      if (cmd.includes("ls") && cmd.some((c) => c.includes("runConfigurations"))) {
        return Promise.resolve(createShellResult(cmd, { stdout: "Quarkus.xml\nWeb.xml\n" }));
      }
      return Promise.resolve(createShellResult(cmd));
    });
    const originalFile = Bun.file;
    Bun.file = mock((path: string) => ({
      exists: () => Promise.resolve(
        path.includes(".git") ||
        !path.includes("worktrees") ||
        path.includes("templates")
      ),
      text: () => Promise.resolve(
        path.includes(".env")
          ? 'BRANCH_NAME="feat-123"'
          : path.includes("json")
          ? "{}"
          : ""
      ),
    })) as any;
    try {
      await run(mocks, []);
      expect(mocks.allocate).toHaveBeenCalledWith(false);
      expect(mocks.worktree).toHaveBeenCalledTimes(3);
      expect(mocks.markTouched).toHaveBeenCalledWith("feat-123", "new");
    } finally {
      Bun.file = originalFile;
    }
  });

  test("registers backend core pom as IntelliJ Maven project", async () => {
    const mocks = createMocks();
    const originalFile = Bun.file;
    Bun.file = mock((path: string) => ({
      exists: () => Promise.resolve(
        path.includes(".git") ||
        !path.includes("worktrees") ||
        path.includes("templates")
      ),
      text: () => Promise.resolve(""),
    })) as any;
    try {
      await run(mocks, []);
      expect(mocks.copyTpl).toHaveBeenCalledWith(
        expect.stringContaining("templates/idea/workspace.xml"),
        expect.stringContaining(".idea/workspace.xml"),
        expect.objectContaining({ BACKEND_CORE_MODULE: "scalemed-core" }),
      );
    } finally {
      Bun.file = originalFile;
    }
  });

  test("runs new:after hooks with IntelliJ database context", async () => {
    const mocks = createMocks();
    const originalFile = Bun.file;
    Bun.file = mock((path: string) => ({
      exists: () => Promise.resolve(
        path.includes(".git") ||
        !path.includes("worktrees") ||
        path.includes("templates")
      ),
      text: () => Promise.resolve(""),
    })) as any;
    try {
      await run(mocks, []);
      expect(mocks.hooks).toHaveBeenCalledWith(
        "new:after",
        expect.objectContaining({
          branch: "feat-123",
          dbPort: 5438,
          dbUser: "postgres",
          dbName: expect.any(String),
          dbSchema: "core",
          productName: "neurosteps",
          repos: [
            { name: "backend", path: "backend" },
            { name: "frontend", path: "frontend" },
            { name: "docs", path: "docs" },
          ],
        }),
      );
    } finally {
      Bun.file = originalFile;
    }
  });

  test("creates new branch with manager", async () => {
    const mocks = createMocks();
    mocks.allocate = mock((withManager?: boolean) => ({ db: 5438, backend: 8084, backendDebug: 5005, management: 9001, frontend: 3015, manager: 3021 }));
    mocks.shell = mock((cmd: string[]) => {
      if (cmd.includes("ls") && cmd.some((c) => c.includes("runConfigurations"))) {
        return Promise.resolve(createShellResult(cmd, { stdout: "Quarkus.xml\nWeb.xml\n" }));
      }
      return Promise.resolve(createShellResult(cmd));
    });
    const originalFile = Bun.file;
    Bun.file = mock((path: string) => ({
      exists: () => Promise.resolve(
        path.includes(".git") ||
        !path.includes("worktrees") ||
        path.includes("templates")
      ),
      text: () => Promise.resolve(
        path.includes(".env")
          ? 'BRANCH_NAME="feat-123"'
          : path.includes("json")
          ? "{}"
          : ""
      ),
    })) as any;
    try {
      await run(mocks, ["manager"]);
      expect(mocks.allocate).toHaveBeenCalledWith(true);
      expect(mocks.worktree).toHaveBeenCalledTimes(4);
      expect(mocks.markTouched).toHaveBeenCalledWith("feat-123", "new");
    } finally {
      Bun.file = originalFile;
    }
  });

  test("passes manager repo to new:after hooks when manager is enabled", async () => {
    const mocks = createMocks();
    mocks.allocate = mock((withManager?: boolean) => ({ db: 5438, backend: 8084, backendDebug: 5005, management: 9001, frontend: 3015, manager: 3021 }));
    const originalFile = Bun.file;
    Bun.file = mock((path: string) => ({
      exists: () => Promise.resolve(
        path.includes(".git") ||
        !path.includes("worktrees") ||
        path.includes("templates")
      ),
      text: () => Promise.resolve(""),
    })) as any;
    try {
      await run(mocks, ["manager"]);
      expect(mocks.hooks).toHaveBeenCalledWith(
        "new:after",
        expect.objectContaining({
          repos: [
            { name: "backend", path: "backend" },
            { name: "frontend", path: "frontend" },
            { name: "docs", path: "docs" },
            { name: "manager", path: "manager" },
          ],
        }),
      );
    } finally {
      Bun.file = originalFile;
    }
  });

  test("fails when manager repo not found", async () => {
    const mocks = createMocks();
    const originalFile = Bun.file;
    // MANAGER_REPO = ~/Developer/neurosteps-manager (from env-setup.ts NS_MANAGER_REPO_NAME)
    Bun.file = mock((path: string) => ({
      exists: () => Promise.resolve(
        path.includes(".git") && !path.includes("neurosteps-manager")
      ),
    })) as any;
    try {
      await run(mocks, ["manager"]);
      expect(false).toBe(true);
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      expect((e as Error).message).toContain("não encontrado");
      expect(e).toMatchObject({ category: "pre-condicao" });
    } finally {
      Bun.file = originalFile;
    }
  });

  test("fails when repo not found", async () => {
    const mocks = createMocks();
    const originalFile = Bun.file;
    // BACKEND_REPO = ~/Developer/scalemed-backend (from env-setup.ts NS_BACKEND_REPO_NAME)
    Bun.file = mock((path: string) => ({
      exists: () => Promise.resolve(
        path.includes(".git") && !path.includes("scalemed-backend")
      ),
    })) as any;
    try {
      await run(mocks, []);
      expect(false).toBe(true);
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      expect((e as Error).message).toContain("não encontrado");
    } finally {
      Bun.file = originalFile;
    }
  });

  const withWorkspaceFiles = async (body: () => Promise<void>) => {
    const originalFile = Bun.file;
    Bun.file = mock((path: string) => ({
      exists: () => Promise.resolve(path.includes(".git") || !path.includes("worktrees") || path.includes("templates")),
      text: () => Promise.resolve(""),
    })) as any;
    try {
      await body();
    } finally {
      Bun.file = originalFile;
    }
  };

  test("includes the other optional repos after the branch exists, then prepares it", async () => {
    const mocks = createMocks();
    const steps: string[] = [];
    const ctx = { ...createSilentContext(), emit: (event: NsProgressEvent) => { steps.push(event.step); } };
    await withWorkspaceFiles(async () => {
      const result = await runNew(
        { branch: "feat-123", repos: ["manager", "report-server", "parents"], installMissingDeps: "never" },
        ctx,
        mocks,
      );

      expect(mocks.addRepo.mock.calls.map(([input]) => input)).toEqual([
        { branch: "feat-123", repo: "report-server" },
        { branch: "feat-123", repo: "parents" },
      ]);
      expect(mocks.prepare).toHaveBeenCalledWith({ branch: "feat-123", installMissingDeps: "never" }, ctx);
      expect(result.repos).toEqual(["manager", "report-server", "parents"]);
      expect(result.missingRepos).toEqual([]);
      expect(result.prepared).toBe(prepared);
    });
    expect(steps.indexOf("new:add:report-server")).toBeGreaterThan(steps.indexOf("new:hooks"));
    expect(steps).toContain("new:add:parents");
  });

  test("keeps and prepares the branch when an optional repo fails, naming the repo", async () => {
    const mocks = createMocks();
    mocks.addRepo = mock(({ repo }: { repo: string }) => repo === "report-server"
      ? Promise.reject(naoEncontrado("Branch base 'origin/master' não existe no report-server"))
      : Promise.resolve({ branch: "feat-123", repo: "parents" as const, path: "" })) as any;
    await withWorkspaceFiles(async () => {
      const result = await run(mocks, ["report-server", "parents"]);

      expect(result.repos).toEqual(["parents"]);
      expect(result.missingRepos).toEqual([{
        repo: "report-server",
        category: "nao-encontrado",
        message: "Branch base 'origin/master' não existe no report-server",
      }]);
      expect(mocks.markTouched).toHaveBeenCalledWith("feat-123", "new");
      expect(mocks.prepare).toHaveBeenCalled();
    });
  });

  test("gives the nickname right after the branch exists, before the optional repos, and keeps it if one fails", async () => {
    const mocks = createMocks();
    const order: string[] = [];
    mocks.copyTpl = mock((_src: string, dst: string) => { if (dst.endsWith(".workspace.env")) order.push("workspace.env"); return Promise.resolve(); });
    mocks.setNickname = mock((input: SetNicknameInput) => { order.push("nickname"); return Promise.resolve({ branch: input.branch, nickname: input.nickname }); });
    mocks.hooks = mock(() => { order.push("hooks"); return Promise.resolve(); });
    mocks.addRepo = mock(() => { order.push("addRepo"); return Promise.reject(new Error("fatal: could not read from remote repository")); }) as any;
    await withWorkspaceFiles(async () => {
      const result = await runNew(
        { branch: "feat-123", repos: ["parents"], installMissingDeps: "never", nickname: "  Guia TISS em lote \n" },
        createSilentContext(),
        mocks,
      );

      expect(result.missingRepos.map(({ repo }) => repo)).toEqual(["parents"]);
    });
    expect(mocks.setNickname.mock.calls.map(([input]) => input)).toEqual([{ branch: "feat-123", nickname: "Guia TISS em lote" }]);
    expect(order).toEqual(["workspace.env", "nickname", "hooks", "addRepo"]);
  });

  test("goes on without the nickname when it can't be written", async () => {
    const mocks = createMocks();
    mocks.setNickname = mock(() => Promise.reject(new Error("EACCES: permission denied"))) as any;
    await withWorkspaceFiles(async () => {
      const result = await runNew({ branch: "feat-123", repos: [], installMissingDeps: "never", nickname: "Agenda" }, createSilentContext(), mocks);

      expect(result.prepared).toBe(prepared);
    });
    expect(mocks.hooks).toHaveBeenCalled();
  });

  test("creates the branch without a nickname when none or a blank one is given", async () => {
    const mocks = createMocks();
    await withWorkspaceFiles(async () => {
      await run(mocks, []);
      await runNew({ branch: "feat-123", repos: [], installMissingDeps: "never", nickname: "   " }, createSilentContext(), mocks);
    });
    expect(mocks.setNickname).not.toHaveBeenCalled();
  });

  test("refuses a nickname over 40 characters before creating anything", async () => {
    const mocks = createMocks();
    await withWorkspaceFiles(async () => {
      const creating = runNew({ branch: "feat-123", repos: [], installMissingDeps: "never", nickname: "a".repeat(41) }, createSilentContext(), mocks);

      await expect(creating).rejects.toMatchObject({ category: "pre-condicao" });
    });
    expect(mocks.worktree).not.toHaveBeenCalled();
    expect(mocks.copyTpl).not.toHaveBeenCalled();
    expect(mocks.setNickname).not.toHaveBeenCalled();
  });

  test("reports a failing tool in an optional repo as ferramenta-externa", async () => {
    const mocks = createMocks();
    mocks.addRepo = mock(() => Promise.reject(new Error("fatal: could not read from remote repository"))) as any;
    await withWorkspaceFiles(async () => {
      const result = await run(mocks, ["parents"]);

      expect(result.missingRepos).toEqual([{
        repo: "parents",
        category: "ferramenta-externa",
        message: "fatal: could not read from remote repository",
      }]);
    });
  });

  test("reports a failing git while creating the branch as ferramenta-externa", async () => {
    const mocks = createMocks();
    mocks.worktree = mock(() => Promise.reject(new Error("fatal: 'feat-123' is already checked out")));
    await withWorkspaceFiles(async () => {
      await expect(run(mocks)).rejects.toMatchObject({ category: "ferramenta-externa", message: "fatal: 'feat-123' is already checked out" });
      expect(mocks.prepare).not.toHaveBeenCalled();
    });
  });

  test("asks for each optional repo once and carries the paths and port of the included repos", async () => {
    const mocks = createMocks();
    mocks.addRepo = mock((input: AddRepoInput, _ctx: NsContext) => Promise.resolve({
      branch: input.branch,
      repo: input.repo,
      path: `/w/feat-123/${input.repo}`,
      ...(input.repo === "report-server" ? { port: 3031 } : {}),
    }));
    await withWorkspaceFiles(async () => {
      const result = await run(mocks, ["parents", "report-server", "parents"]);

      expect(mocks.addRepo).toHaveBeenCalledTimes(2);
      expect(result.repos).toEqual(["parents", "report-server"]);
      expect(result.paths.parents).toBe("/w/feat-123/parents");
      expect(result.paths.reportServer).toBe("/w/feat-123/report-server");
      expect(result.ports.reportServer).toBe(3031);
    });
  });

  test("a failing prepare keeps its category and says the branch was created", async () => {
    const mocks = createMocks();
    mocks.prepare = mock(() => Promise.reject(new Error("Cannot connect to the Docker daemon")));
    await withWorkspaceFiles(async () => {
      await expect(run(mocks)).rejects.toMatchObject({
        category: "ferramenta-externa",
        message: "Cannot connect to the Docker daemon",
        hint: "A branch foi criada. Para preparar de novo: ns prepare feat-123",
      });
      expect(mocks.markTouched).toHaveBeenCalledWith("feat-123", "new");
    });
  });
});
