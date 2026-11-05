import { describe, test, expect, mock } from "bun:test";
import { startAction, type StartActionDeps } from "../../commands/dev";
import { createMockWorkspaceEnv, createShellResult } from "../setup";

/** tmux instalado e sem sessão nenhuma: toda sessão é criada do zero. */
const freshTmux = () =>
  mock((command: string[]) => Promise.resolve(command[1] === "display-message"
    ? createShellResult(command, { exitCode: 1, stderr: "can't find session" })
    : createShellResult(command)));
const noTmux = () => mock((_command: string[]) => Promise.reject(new Error("ENOENT: tmux")));

describe("startAction", () => {
  const createDeps = (overrides: StartActionDeps = {}): StartActionDeps => ({
    readEnv: mock(() => Promise.resolve(createMockWorkspaceEnv())) as StartActionDeps["readEnv"],
    composeUp: mock(() => Promise.resolve()) as StartActionDeps["composeUp"],
    waitPg: mock(() => Promise.resolve()) as StartActionDeps["waitPg"],
    regAlias: mock(() => Promise.resolve()) as StartActionDeps["regAlias"],
    proxyRunning: mock(() => true) as StartActionDeps["proxyRunning"],
    proxyStart: mock(() => Promise.resolve()) as StartActionDeps["proxyStart"],
    markTouched: mock(() => Promise.resolve()) as StartActionDeps["markTouched"],
    spawnTerm: mock(
      async (_cwd: string, _env: Record<string, string>, _command: string): Promise<void> => {},
    ) as StartActionDeps["spawnTerm"],
    hasManager: mock((_branch: string) => true) as StartActionDeps["hasManager"],
    hasReportServer: mock((_branch: string) => false) as StartActionDeps["hasReportServer"],
    depsPresent: mock((_marker: string) => true),
    runTmux: freshTmux() as StartActionDeps["runTmux"],
    ...overrides,
  });

  test("sobe cada serviço numa sessão tmux e abre a janela como vista dela", async () => {
    const spawnTerm = mock(async (_cwd: string, _env: Record<string, string>, _command: string): Promise<void> => {});
    const runTmux = freshTmux();

    await startAction("feat-123", createDeps({ spawnTerm, runTmux: runTmux as StartActionDeps["runTmux"] }));

    const created = runTmux.mock.calls.map(([command]) => command).filter((command) => command[1] === "new-session");
    expect(created.map((command) => command[4])).toEqual([
      "ns-feat-123-backend",
      "ns-feat-123-frontend",
      "ns-feat-123-manager",
    ]);
    expect(created[0]?.find((arg) => arg.startsWith("cd "))).toContain("export QUARKUS_HTTP_PORT=8084");
    expect(created[0]?.find((arg) => arg.startsWith("cd "))).toContain("mvn -pl scalemed-core quarkus:dev");
    expect(spawnTerm.mock.calls.map(([, env, command]) => [env, command])).toEqual([
      [{}, "tmux attach-session -t ns-feat-123-backend"],
      [{}, "tmux attach-session -t ns-feat-123-frontend"],
      [{}, "tmux attach-session -t ns-feat-123-manager"],
    ]);
  });

  test("com um serviço, sobe e abre só a janela dele", async () => {
    const spawnTerm = mock(async (_cwd: string, _env: Record<string, string>, _command: string): Promise<void> => {});
    const runTmux = freshTmux();

    await startAction("feat-123", createDeps({
      service: "frontend",
      spawnTerm,
      runTmux: runTmux as StartActionDeps["runTmux"],
    }));

    const created = runTmux.mock.calls.map(([command]) => command).filter((command) => command[1] === "new-session");
    expect(created.map((command) => command[4])).toEqual(["ns-feat-123-frontend"]);
    expect(spawnTerm.mock.calls.map(([, , command]) => command)).toEqual(["tmux attach-session -t ns-feat-123-frontend"]);
  });

  test("um serviço que a branch não tem falha sem subir nada", async () => {
    const runTmux = freshTmux();

    await expect(startAction("feat-123", createDeps({
      service: "report-server",
      runTmux: runTmux as StartActionDeps["runTmux"],
    }))).rejects.toThrow("A branch 'feat-123' não tem o Serviço report-server");
    expect(runTmux.mock.calls.some(([command]) => command[1] === "new-session")).toBe(false);
  });

  test("sem tmux, avisa e roda os serviços dentro das janelas", async () => {
    const spawnTerm = mock(async (_cwd: string, _env: Record<string, string>, _command: string): Promise<void> => {});
    const originalError = console.error;
    const output: string[] = [];
    console.error = mock((message?: unknown) => output.push(String(message ?? ""))) as any;

    try {
      await startAction("feat-123", createDeps({ spawnTerm, runTmux: noTmux() as StartActionDeps["runTmux"] }));
    } finally {
      console.error = originalError;
    }

    expect(output.join("\n")).toContain("tmux não encontrado");
    expect(output.join("\n")).toContain("brew install tmux");
    expect(spawnTerm).toHaveBeenCalledTimes(3);
    expect(spawnTerm.mock.calls[0]?.[1]).toMatchObject({
      QUARKUS_HTTP_PORT: "8084",
      QUARKUS_MANAGEMENT_PORT: "9001",
      QUARKUS_DATASOURCE_JDBC_URL: "jdbc:postgresql://localhost:5438/app_database",
      QUARKUS_DATASOURCE_USERNAME: "postgres",
      QUARKUS_DATASOURCE_PASSWORD: "docker",
    });
    expect(spawnTerm.mock.calls[0]?.[2]).toBe("mvn -pl scalemed-core quarkus:dev");
    expect(spawnTerm.mock.calls[1]?.[2]).toBe("npm start");
    expect(spawnTerm.mock.calls[2]?.[2]).toBe("npm run dev");
  });

  test("não reinicia um serviço que já está rodando na sessão", async () => {
    const runTmux = mock((command: string[]) => Promise.resolve(command[1] === "display-message"
      ? createShellResult(command, { stdout: "0\n" })
      : createShellResult(command)));

    await startAction("feat-123", createDeps({ runTmux: runTmux as StartActionDeps["runTmux"] }));

    expect(runTmux.mock.calls.some(([command]) => command[1] === "new-session")).toBe(false);
  });

  test("backfills management port for worktrees created before MANAGEMENT_PORT existed", async () => {
    const spawnTerm = mock(async (_cwd: string, _env: Record<string, string>, _command: string): Promise<void> => {});
    const ensureManagementPort = mock((_branch: string, current?: number) => Promise.resolve(current ?? 9002));
    const deps = createDeps({
      spawnTerm,
      runTmux: noTmux() as StartActionDeps["runTmux"],
      ensureManagementPort,
      readEnv: mock(() => Promise.resolve(createMockWorkspaceEnv({ MANAGEMENT_PORT: undefined }))) as StartActionDeps["readEnv"],
    });

    await startAction("feat-123", deps);

    expect(ensureManagementPort).toHaveBeenCalledWith("feat-123", undefined);
    expect(spawnTerm.mock.calls[0]?.[1]).toMatchObject({ QUARKUS_MANAGEMENT_PORT: "9002" });
  });

  test("prints URLs and manual commands when Terminal.app cannot be opened", async () => {
    const spawnTerm = mock(async (_cwd: string, _env: Record<string, string>, _command: string): Promise<void> => {
      throw new Error("Falha ao abrir Terminal.app no macOS (exit 1): osascript -e ...");
    });
    const deps = createDeps({ spawnTerm, runTmux: noTmux() as StartActionDeps["runTmux"] });
    const originalError = console.error;
    const output: string[] = [];
    console.error = mock((message?: unknown) => output.push(String(message ?? ""))) as any;

    try {
      await startAction("feat-123", deps);
    } finally {
      console.error = originalError;
    }

    expect(spawnTerm).toHaveBeenCalledTimes(1);
    const text = output.join("\n");
    expect(text).toContain("Terminal.app não abriu automaticamente para feat-123");
    expect(text).toContain("https://feat-123.api.neurosteps.localhost:1355/api");
    expect(text).toContain("DB e aliases Portless foram preparados");
    expect(text).toContain("mvn -pl scalemed-core quarkus:dev");
    expect(text).toContain("npm start");
    expect(text).toContain("npm run dev");
  });

  test("sem Terminal.app, diz como ver as sessões tmux que já estão rodando", async () => {
    const spawnTerm = mock(async (_cwd: string, _env: Record<string, string>, _command: string): Promise<void> => {
      throw new Error("Falha ao abrir Terminal.app no macOS (exit 1): osascript -e ...");
    });
    const originalError = console.error;
    const output: string[] = [];
    console.error = mock((message?: unknown) => output.push(String(message ?? ""))) as any;

    try {
      await startAction("feat-123", createDeps({ spawnTerm }));
    } finally {
      console.error = originalError;
    }

    const text = output.join("\n");
    expect(text).toContain("Os serviços estão rodando em sessões tmux");
    expect(text).toContain("tmux attach-session -t ns-feat-123-backend");
    expect(text).toContain("tmux attach-session -t ns-feat-123-manager");
    expect(text).not.toContain("rode manualmente");
  });

  test("avisa como instalar à mão as dependências que ficaram faltando", async () => {
    const deps = createDeps({
      depsPresent: mock((_marker: string) => false),
      run: mock((command: string[]) => Promise.resolve({ exitCode: 1, stdout: "", stderr: "", command })),
    });
    const originalError = console.error;
    const output: string[] = [];
    console.error = mock((message?: unknown) => output.push(String(message ?? ""))) as any;

    try {
      await startAction("feat-123", deps);
    } finally {
      console.error = originalError;
    }

    const text = output.join("\n");
    expect(text).toContain("Falha ao instalar dependências do frontend");
    expect(text).toContain("Rode manualmente: npm install em");
  });
});
