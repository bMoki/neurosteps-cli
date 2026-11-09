import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { NsError, createSilentContext, runPrepare } from "../../core";
import type { NsContext, NsProgressEvent, NsQuestion, PrepareDeps, PrepareInput } from "../../core";
import { createMockWorkspaceEnv, createShellResult } from "../setup";
import { join } from "path";
import { STATE_DIR, WORKTREES_DIR } from "../../lib/config";

type WorkspaceEnv = Awaited<ReturnType<PrepareDeps["readEnv"]>>;

function createDeps(overrides: Partial<PrepareDeps> = {}): Partial<PrepareDeps> {
  return {
    readEnv: mock(() => Promise.resolve(createMockWorkspaceEnv({ REPORT_SERVER_PORT: 3031 }) as WorkspaceEnv)),
    composeUp: mock(() => Promise.resolve()),
    waitPg: mock(() => Promise.resolve()),
    regAlias: mock(() => Promise.resolve()),
    proxyRunning: mock(() => true),
    proxyStart: mock(() => Promise.resolve()),
    markTouched: mock(() => Promise.resolve()),
    ensureManagementPort: mock((_branch: string, current?: number) => Promise.resolve(current ?? 9002)),
    hasManager: mock(() => true),
    hasReportServer: mock(() => true),
    depsPresent: mock(() => true),
    run: mock((command: string[]) => Promise.resolve(createShellResult(command))),
    ...overrides,
  };
}

function input(overrides: Partial<PrepareInput> = {}): PrepareInput {
  return { branch: "feat-123", installMissingDeps: "always", ...overrides };
}

function answering(value: boolean, asked: NsQuestion[] = []): NsContext {
  return {
    emit() {},
    async ask(question) {
      asked.push(question);
      return value;
    },
  };
}

describe("runPrepare", () => {
  test("devolve o plano de cada serviço com rótulo, pasta, variáveis, comando e porta", async () => {
    const result = await runPrepare(input(), createSilentContext(), createDeps());

    expect(result.branch).toBe("feat-123");
    expect(result.ports).toEqual({ db: 5438, backend: 8084, frontend: 3015, manager: 3021, reportServer: 3031 });
    expect(result.services.map((service) => [service.id, service.label, service.command, service.port])).toEqual([
      ["backend", "Backend", "mvn -pl scalemed-core quarkus:dev", 8084],
      ["frontend", "Frontend", "npm start", 3015],
      ["manager", "Manager", "npm run dev", 3021],
      ["report-server", "Report-server", "bun run dev", 3031],
    ]);
    const [backend, frontend] = result.services;
    expect(backend?.env).toMatchObject({
      QUARKUS_HTTP_PORT: "8084",
      QUARKUS_MANAGEMENT_PORT: "9001",
      QUARKUS_DATASOURCE_JDBC_URL: "jdbc:postgresql://localhost:5438/app_database",
    });
    expect(frontend?.env).toMatchObject({ REACT_APP_API_URL: "https://feat-123.api.neurosteps.localhost:1355/api" });
    expect(result.services.every((service) => service.cwd.length > 0)).toBe(true);
  });

  test("cada Serviço do plano traz a sessão tmux e o arquivo de log", async () => {
    const result = await runPrepare(input(), createSilentContext(), createDeps());

    expect(result.services.map((service) => [service.session, service.logFile])).toEqual([
      ["ns-feat-123-backend", join(STATE_DIR, "feat-123", "backend.log")],
      ["ns-feat-123-frontend", join(STATE_DIR, "feat-123", "frontend.log")],
      ["ns-feat-123-manager", join(STATE_DIR, "feat-123", "manager.log")],
      ["ns-feat-123-report-server", join(STATE_DIR, "feat-123", "report-server.log")],
    ]);
  });

  test("sem os Repos opcionais, o plano tem só backend e frontend", async () => {
    const result = await runPrepare(input(), createSilentContext(), createDeps({
      hasManager: mock(() => false),
      hasReportServer: mock(() => false),
    }));

    expect(result.services.map((service) => service.id)).toEqual(["backend", "frontend"]);
    expect(result.urls.manager).toBe("https://feat-123.manager.neurosteps.localhost:1355");
  });

  test("withManager e withReportServer falsos deixam os Repos opcionais fora mesmo existindo", async () => {
    const depsPresent = mock((_marker: string) => false);
    const result = await runPrepare(
      input({ withManager: false, withReportServer: false }),
      createSilentContext(),
      createDeps({ depsPresent }),
    );

    expect(result.services.map((service) => service.id)).toEqual(["backend", "frontend"]);
    expect(result.depsInstalled).toEqual(["frontend"]);
  });

  test("completa a porta de management de worktrees antigas", async () => {
    const ensureManagementPort = mock((_branch: string, current?: number) => Promise.resolve(current ?? 9002));
    const result = await runPrepare(input(), createSilentContext(), createDeps({
      ensureManagementPort,
      readEnv: mock(() => Promise.resolve(createMockWorkspaceEnv({ MANAGEMENT_PORT: undefined }) as WorkspaceEnv)),
    }));

    expect(ensureManagementPort).toHaveBeenCalledWith("feat-123", undefined);
    expect(result.services[0]?.env.QUARKUS_MANAGEMENT_PORT).toBe("9002");
  });

  test("always instala as dependências faltando sem perguntar", async () => {
    const run = mock((command: string[]) => Promise.resolve(createShellResult(command)));
    const asked: NsQuestion[] = [];
    const result = await runPrepare(input(), answering(false, asked), createDeps({
      run,
      depsPresent: mock(() => false),
    }));

    expect(asked).toEqual([]);
    expect(result.depsInstalled).toEqual(["frontend", "manager", "report-server"]);
    expect(result.depsMissing).toEqual([]);
    expect(run.mock.calls.map(([command]) => command.join(" "))).toEqual(["npm ci", "npm ci", "bun install"]);
  });

  test("ask respondido com não deixa a dependência faltando e não instala nada", async () => {
    const run = mock((command: string[]) => Promise.resolve(createShellResult(command)));
    const asked: NsQuestion[] = [];
    const result = await runPrepare(
      input({ installMissingDeps: "ask", withManager: false, withReportServer: false }),
      answering(false, asked),
      createDeps({ run, depsPresent: mock(() => false) }),
    );

    expect(run).not.toHaveBeenCalled();
    expect(asked).toEqual([expect.objectContaining({
      id: "prepare.install-deps.frontend",
      default: true,
      whenUnavailable: "default",
    })]);
    expect(result.depsMissing).toEqual([
      expect.objectContaining({ id: "frontend", command: "npm install", reason: "recusado" }),
    ]);
  });

  test("ask sem quem responda instala, pelo padrão da pergunta", async () => {
    const result = await runPrepare(
      input({ installMissingDeps: "ask", withManager: false, withReportServer: false }),
      createSilentContext(),
      createDeps({ depsPresent: mock(() => false) }),
    );

    expect(result.depsInstalled).toEqual(["frontend"]);
  });

  test("never não pergunta nem instala", async () => {
    const run = mock((command: string[]) => Promise.resolve(createShellResult(command)));
    const asked: NsQuestion[] = [];
    const result = await runPrepare(input({ installMissingDeps: "never" }), answering(true, asked), createDeps({
      run,
      depsPresent: mock(() => false),
    }));

    expect(asked).toEqual([]);
    expect(run).not.toHaveBeenCalled();
    expect(result.depsMissing.map((missing) => missing.id)).toEqual(["frontend", "manager", "report-server"]);
  });

  test("npm ci que lança cai para npm install; falha de instalação não aborta", async () => {
    const run = mock((command: string[]) => {
      if (command.join(" ") === "npm ci") return Promise.reject(new Error("npm ci indisponível"));
      if (command[0] === "bun") return Promise.resolve(createShellResult(command, { exitCode: 1 }));
      return Promise.resolve(createShellResult(command));
    });
    const result = await runPrepare(input({ withManager: false }), createSilentContext(), createDeps({
      run,
      depsPresent: mock(() => false),
    }));

    expect(run.mock.calls.map(([command]) => command.join(" "))).toEqual(["npm ci", "npm install", "bun install"]);
    expect(result.depsInstalled).toEqual(["frontend"]);
    expect(result.depsMissing).toEqual([
      expect.objectContaining({ id: "report-server", command: "bun install", reason: "falhou" }),
    ]);
  });

  test("emite o progresso da preparação e da instalação", async () => {
    const events: NsProgressEvent[] = [];
    await runPrepare(
      input({ withManager: false, withReportServer: false }),
      { emit: (event) => events.push(event), ask: async () => true },
      createDeps({ proxyRunning: mock(() => false), depsPresent: mock(() => false) }),
    );

    expect(events.map((event) => event.step)).toEqual([
      "database:start",
      "database:wait",
      "portless:proxy",
      "portless:aliases",
      "prepare:deps",
      "prepare:deps:frontend",
      "prepare:deps:frontend:done",
    ]);
    expect(events[0]?.label).toBe("Iniciando PostgreSQL...");
  });

  describe("reaproveitando as dependências da master", () => {
    const fromMaster = (path: string) => path.includes("/worktrees/master/");
    const worktrees = ["feat-123", "master"].flatMap((branch) =>
      ["frontend", "manager", "report-server"].map((repo) => join(WORKTREES_DIR, branch, repo)));

    beforeAll(() => worktrees.forEach((dir) => mkdirSync(dir, { recursive: true })));
    afterAll(() => worktrees.forEach((dir) => rmSync(dir, { recursive: true, force: true })));
    const commands = (run: ReturnType<typeof mock>) =>
      (run.mock.calls as [string[]][]).map(([command]) => command.join(" ").replace(/\S*\/worktrees\//g, ""));

    test("clona o node_modules da master e para ali quando bate com o declarado", async () => {
      const run = mock((command: string[]) => Promise.resolve(createShellResult(command)));
      const asked: NsQuestion[] = [];
      const result = await runPrepare(input({ withReportServer: false }), answering(false, asked), createDeps({
        run,
        depsPresent: mock(fromMaster),
        installedMatchesLockfile: mock(() => true),
      }));

      expect(asked).toEqual([]);
      expect(commands(run)).toEqual([
        "rm -rf feat-123/frontend/node_modules.ns-reuse",
        "cp -cR master/frontend/node_modules feat-123/frontend/node_modules.ns-reuse",
        "touch feat-123/frontend/node_modules.ns-reuse/.ns-from-master",
        "mv feat-123/frontend/node_modules.ns-reuse feat-123/frontend/node_modules",
        "rm -rf feat-123/manager/node_modules.ns-reuse",
        "cp -cR master/manager/node_modules feat-123/manager/node_modules.ns-reuse",
        "touch feat-123/manager/node_modules.ns-reuse/.ns-from-master",
        "mv feat-123/manager/node_modules.ns-reuse feat-123/manager/node_modules",
      ]);
      expect(result.depsReused).toEqual(["frontend", "manager"]);
      expect(result.depsInstalled).toEqual([]);
      expect(result.depsMissing).toEqual([]);
    });

    test("com divergência, always instala só as diferenças sem perguntar", async () => {
      const run = mock((command: string[]) => Promise.resolve(createShellResult(command)));
      const asked: NsQuestion[] = [];
      const result = await runPrepare(input({ withManager: false }), answering(false, asked), createDeps({
        run,
        depsPresent: mock(fromMaster),
        installedMatchesLockfile: mock(() => false),
      }));

      expect(asked).toEqual([]);
      expect(commands(run).filter((command) => command.endsWith("install"))).toEqual(["npm install", "bun install"]);
      expect(result.depsReused).toEqual(["frontend", "report-server"]);
      expect(result.depsInstalled).toEqual(["frontend", "report-server"]);
    });

    test("com divergência, ask pergunta se instala as diferenças", async () => {
      const run = mock((command: string[]) => Promise.resolve(createShellResult(command)));
      const asked: NsQuestion[] = [];
      const result = await runPrepare(
        input({ installMissingDeps: "ask", withManager: false, withReportServer: false }),
        answering(false, asked),
        createDeps({ run, depsPresent: mock(fromMaster), installedMatchesLockfile: mock(() => false) }),
      );

      expect(asked).toEqual([{
        id: "prepare.update-reused-deps.frontend",
        message: "As dependências do frontend diferem da master. Instalar as diferenças agora?",
        default: true,
        whenUnavailable: "default",
      }]);
      expect(commands(run).some((command) => command.includes("install"))).toBe(false);
      expect(result.depsReused).toEqual(["frontend"]);
      expect(result.depsMissing).toEqual([
        expect.objectContaining({ id: "frontend", command: "npm install", reason: "divergente" }),
      ]);
    });

    test("com divergência, never fica com as da master e avisa", async () => {
      const run = mock((command: string[]) => Promise.resolve(createShellResult(command)));
      const result = await runPrepare(
        input({ installMissingDeps: "never", withManager: false, withReportServer: false }),
        createSilentContext(),
        createDeps({ run, depsPresent: mock(fromMaster), installedMatchesLockfile: mock(() => false) }),
      );

      expect(result.depsReused).toEqual(["frontend"]);
      expect(result.depsMissing).toEqual([expect.objectContaining({ id: "frontend", reason: "divergente" })]);
    });

    test("falha ao instalar as diferenças fica em depsMissing", async () => {
      const run = mock((command: string[]) =>
        Promise.resolve(createShellResult(command, { exitCode: command[1] === "install" ? 1 : 0 })));
      const result = await runPrepare(
        input({ withManager: false, withReportServer: false }),
        createSilentContext(),
        createDeps({ run, depsPresent: mock(fromMaster), installedMatchesLockfile: mock(() => false) }),
      );

      expect(result.depsMissing).toEqual([expect.objectContaining({ id: "frontend", command: "npm install", reason: "falhou" })]);
    });

    test("clone que falha limpa a pasta temporária e instala do zero", async () => {
      const run = mock((command: string[]) =>
        Promise.resolve(createShellResult(command, { exitCode: command[0] === "cp" ? 1 : 0 })));
      const result = await runPrepare(
        input({ withManager: false, withReportServer: false }),
        createSilentContext(),
        createDeps({ run, depsPresent: mock(fromMaster) }),
      );

      expect(commands(run)).toEqual([
        "rm -rf feat-123/frontend/node_modules.ns-reuse",
        "cp -cR master/frontend/node_modules feat-123/frontend/node_modules.ns-reuse",
        "rm -rf feat-123/frontend/node_modules.ns-reuse",
        "npm ci",
      ]);
      expect(result.depsReused).toEqual([]);
      expect(result.depsInstalled).toEqual(["frontend"]);
    });

    test("sem node_modules na master instala do zero", async () => {
      const run = mock((command: string[]) => Promise.resolve(createShellResult(command)));
      const result = await runPrepare(input(), createSilentContext(), createDeps({ run, depsPresent: mock(() => false) }));

      expect(commands(run)).toEqual(["npm ci", "npm ci", "bun install"]);
      expect(result.depsReused).toEqual([]);
    });

    test("preparando a própria master instala do zero", async () => {
      const run = mock((command: string[]) => Promise.resolve(createShellResult(command)));
      const result = await runPrepare(
        input({ branch: "master", withManager: false, withReportServer: false }),
        createSilentContext(),
        createDeps({ run, depsPresent: mock((path: string) => fromMaster(path) && !path.endsWith("node_modules/.bin/vite")) }),
      );

      expect(commands(run)).toEqual(["npm ci"]);
      expect(result.depsReused).toEqual([]);
    });

    test("Repo sem worktree na branch não recebe o clone no Repo base", async () => {
      const run = mock((command: string[]) => Promise.resolve(createShellResult(command)));
      const result = await runPrepare(
        input({ branch: "sem-worktree", withManager: false, withReportServer: false }),
        createSilentContext(),
        createDeps({ run, depsPresent: mock(fromMaster) }),
      );

      expect(commands(run)).toEqual(["npm ci"]);
      expect(result.depsReused).toEqual([]);
    });

    test("node_modules incompleto na branch não é tocado pelo reaproveitamento", async () => {
      const run = mock((command: string[]) => Promise.resolve(createShellResult(command)));
      const result = await runPrepare(
        input({ withManager: false, withReportServer: false }),
        createSilentContext(),
        createDeps({ run, depsPresent: mock((path: string) => fromMaster(path) || path.endsWith("frontend/node_modules")) }),
      );

      expect(commands(run)).toEqual(["npm ci"]);
      expect(result.depsReused).toEqual([]);
    });
  });

  test("falha do Docker ao subir o banco vira erro ferramenta-externa com a mensagem original", async () => {
    const promise = runPrepare(input(), createSilentContext(), createDeps({
      composeUp: mock(() => Promise.reject(new Error("Falha ao subir docker compose"))),
    }));

    await expect(promise).rejects.toMatchObject({
      category: "ferramenta-externa",
      message: "Falha ao subir docker compose",
    });
  });

  test("branch inexistente é erro nao-encontrado", async () => {
    const promise = runPrepare(input({ branch: "nope" }), createSilentContext(), createDeps({
      readEnv: mock(() => Promise.resolve(null)),
    }));

    await expect(promise).rejects.toBeInstanceOf(NsError);
    await expect(promise).rejects.toMatchObject({ category: "nao-encontrado" });
  });
});
