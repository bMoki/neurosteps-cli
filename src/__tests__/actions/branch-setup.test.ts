import { describe, test, expect, mock } from "bun:test";
import {
  BranchNotFoundError,
  setupBranchRuntime,
  type BranchSetupDeps,
  type BranchSetupStep,
} from "../../actions/branch-setup";
import { WORKTREES_DIR } from "../../lib/config";
import { createMockWorkspaceEnv } from "../setup";
import { join } from "path";

describe("setupBranchRuntime", () => {
  const createDeps = (overrides: Partial<BranchSetupDeps> = {}): BranchSetupDeps => ({
    readEnv: mock(() => Promise.resolve(createMockWorkspaceEnv())) as BranchSetupDeps["readEnv"],
    composeUp: mock(() => Promise.resolve()) as BranchSetupDeps["composeUp"],
    waitPg: mock(() => Promise.resolve()) as BranchSetupDeps["waitPg"],
    regAlias: mock(() => Promise.resolve()) as BranchSetupDeps["regAlias"],
    proxyRunning: mock(() => false) as BranchSetupDeps["proxyRunning"],
    proxyStart: mock(() => Promise.resolve()) as BranchSetupDeps["proxyStart"],
    ...overrides,
  });

  test("starts database, proxy and registers branch aliases", async () => {
    const deps = createDeps();
    const steps: BranchSetupStep[] = [];

    const runtime = await setupBranchRuntime("feat-123", {
      startDatabase: true,
      ensurePortlessProxy: true,
      registerPortlessAliases: true,
      onStep: (step) => steps.push(step),
    }, deps);

    expect(deps.readEnv).toHaveBeenCalledWith("feat-123");
    expect(deps.composeUp).toHaveBeenCalledWith(
      join(WORKTREES_DIR, "feat-123", "docker-compose.yml"),
      "ns-feat-123",
    );
    expect(deps.waitPg).toHaveBeenCalledWith("myapp-psql-feat-123");
    expect(deps.proxyStart).toHaveBeenCalled();
    expect(deps.regAlias).toHaveBeenCalledWith("feat-123.api.neurosteps", 8084);
    expect(deps.regAlias).toHaveBeenCalledWith("feat-123.web.neurosteps", 3015);
    expect(deps.regAlias).toHaveBeenCalledWith("feat-123.manager.neurosteps", 3021);
    expect(steps).toEqual([
      "database:start",
      "database:wait",
      "portless:proxy",
      "portless:aliases",
    ]);
    expect(runtime.urls.backend).toBe("https://feat-123.api.neurosteps.localhost:1355/api");
    expect(runtime.urls.frontend).toBe("https://feat-123.web.neurosteps.localhost:1355");
    expect(runtime.urls.manager).toBe("https://feat-123.manager.neurosteps.localhost:1355");
  });

  test("does not start proxy when it is already running", async () => {
    const deps = createDeps({
      proxyRunning: mock(() => true) as BranchSetupDeps["proxyRunning"],
    });

    await setupBranchRuntime("feat-123", {
      ensurePortlessProxy: true,
      registerPortlessAliases: true,
    }, deps);

    expect(deps.proxyStart).not.toHaveBeenCalled();
    expect(deps.regAlias).toHaveBeenCalledTimes(3);
  });

  test("can register aliases without starting database", async () => {
    const deps = createDeps();

    await setupBranchRuntime("feat-123", {
      ensurePortlessProxy: true,
      registerPortlessAliases: true,
    }, deps);

    expect(deps.composeUp).not.toHaveBeenCalled();
    expect(deps.waitPg).not.toHaveBeenCalled();
    expect(deps.regAlias).toHaveBeenCalledTimes(3);
  });

  test("skips manager alias when branch has no manager port", async () => {
    const deps = createDeps({
      readEnv: mock(() => Promise.resolve(createMockWorkspaceEnv({ MANAGER_PORT: undefined }))) as BranchSetupDeps["readEnv"],
    });

    const runtime = await setupBranchRuntime("feat-123", {
      registerPortlessAliases: true,
    }, deps);

    expect(deps.regAlias).toHaveBeenCalledTimes(2);
    expect(runtime.aliases.manager).toBeUndefined();
    expect(runtime.urls.manager).toBeUndefined();
  });

  test("throws BranchNotFoundError when workspace env is missing", async () => {
    const deps = createDeps({
      readEnv: mock(() => Promise.resolve(null)) as BranchSetupDeps["readEnv"],
    });

    await expect(setupBranchRuntime("missing", {}, deps)).rejects.toThrow(BranchNotFoundError);
    expect(deps.composeUp).not.toHaveBeenCalled();
    expect(deps.regAlias).not.toHaveBeenCalled();
  });
});
