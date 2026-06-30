import { describe, expect, mock, test } from "bun:test";
import { addReportServerAction } from "../../actions/add";
import { createShellResult } from "../setup";

class ProcessExit extends Error {}

describe("addReportServerAction", () => {
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
    allocateReportServerPort: mock(() => 3030),
    shell: mock((command: string[]) => Promise.resolve(createShellResult(command))),
    exists: mock((path: string) => path.endsWith(".workspace.env") || path.endsWith(".git") || path.endsWith("application-dev.properties")),
    ensureBootstrap: mock(() => Promise.resolve({ createdDirs: [], installedTemplates: [], updatedTemplates: [], preservedTemplates: [] })),
    copyTpl: mock(() => Promise.resolve()),
    readText: mock((path: string) => Promise.resolve(
      path.endsWith("application-dev.properties")
        ? "quarkus.http.port=8083\n"
        : 'BRANCH_NAME="NS-927"\nBRANCH_SLUG="ns-927"\n',
    )),
    writeText: mock(() => Promise.resolve()),
  });

  test("adds report-server worktree and writes report-server config", async () => {
    const deps = createDeps();

    await addReportServerAction("NS-927", {}, deps);

    expect(deps.fetch).toHaveBeenCalled();
    expect(deps.localBranch).toHaveBeenCalledWith(expect.any(String), "NS-927", "origin/master");
    expect(deps.worktree).toHaveBeenCalledWith(expect.any(String), expect.stringContaining("/NS-927/report-server"), "NS-927");
    expect(deps.writeText).toHaveBeenCalledWith(expect.stringContaining(".workspace.env"), expect.stringContaining('REPORT_SERVER_PORT="3030"'));
    expect(deps.writeText).toHaveBeenCalledWith(
      expect.stringContaining("application-dev.properties"),
      expect.stringContaining("%dev.quarkus.tls.trust-all=true"),
    );
    expect(deps.writeText).toHaveBeenCalledWith(
      expect.stringContaining("application-dev.properties"),
      expect.stringContaining("%dev.quarkus.rest-client.report-service.url=https://ns-927.report-server.neurosteps.localhost:1355"),
    );
    expect(deps.copyTpl).toHaveBeenCalledWith(
      expect.stringContaining("report-server-.env"),
      expect.stringContaining("/NS-927/report-server/.env"),
      expect.objectContaining({ BRANCH_SLUG: "ns-927", REPORT_SERVER_PORT: "3030" }),
    );
  });

  test("tracks remote report-server branch when it exists", async () => {
    const deps = createDeps();
    deps.branchExistsOrigin = mock(() => Promise.resolve(true));
    deps.localExists = mock((repo: string, branch: string): boolean => false);

    await addReportServerAction("NS-927", {}, deps);

    expect(deps.trackBranch).toHaveBeenCalledWith(expect.any(String), "NS-927");
    expect(deps.localBranch).not.toHaveBeenCalled();
  });

  test("creates report-server branch from requested origin base", async () => {
    const deps = createDeps();
    deps.branchExistsOrigin = mock((repo: string, branch: string) => Promise.resolve(branch === "develop"));

    await addReportServerAction("NS-927", { base: "develop" }, deps);

    expect(deps.localBranch).toHaveBeenCalledWith(expect.any(String), "NS-927", "origin/develop");
  });

  test("uses requested report-server port", async () => {
    const deps = createDeps();

    await addReportServerAction("NS-927", { port: "3045" }, deps);

    expect(deps.allocateReportServerPort).not.toHaveBeenCalled();
    expect(deps.writeText).toHaveBeenCalledWith(expect.any(String), expect.stringContaining('REPORT_SERVER_PORT="3045"'));
  });

  test("exits when report-server already exists", async () => {
    const deps = createDeps();
    deps.exists = mock((path: string) => path.endsWith(".workspace.env") || path.endsWith(".git") || path.endsWith("/report-server"));
    const originalExit = process.exit;
    process.exit = ((code: number) => { throw new ProcessExit(String(code)); }) as any;

    try {
      await addReportServerAction("NS-927", {}, deps);
      expect(false).toBe(true);
    } catch (e) {
      expect(e).toBeInstanceOf(ProcessExit);
    } finally {
      process.exit = originalExit;
    }
  });
});
