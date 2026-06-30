import { describe, test, expect, mock } from "bun:test";
import { startAction, type StartActionDeps } from "../../actions/start";
import { createMockWorkspaceEnv } from "../setup";

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
    branchHasManager: mock((_branch: string) => true) as StartActionDeps["branchHasManager"],
    ...overrides,
  });

  test("opens terminals for backend, frontend and manager", async () => {
    const spawnTerm = mock(async (_cwd: string, _env: Record<string, string>, _command: string): Promise<void> => {});
    const deps = createDeps({ spawnTerm });

    await startAction("feat-123", deps);

    expect(spawnTerm).toHaveBeenCalledTimes(3);
    expect(spawnTerm.mock.calls[0]?.[1]).toMatchObject({
      QUARKUS_HTTP_PORT: "8084",
      QUARKUS_DATASOURCE_JDBC_URL: "jdbc:postgresql://localhost:5438/app_database",
      QUARKUS_DATASOURCE_USERNAME: "postgres",
      QUARKUS_DATASOURCE_PASSWORD: "docker",
    });
    expect(spawnTerm.mock.calls[0]?.[2]).toBe("mvn -pl scalemed-core quarkus:dev");
    expect(spawnTerm.mock.calls[1]?.[2]).toBe("npm start");
    expect(spawnTerm.mock.calls[2]?.[2]).toBe("npm run dev");
  });

  test("prints URLs and manual commands when Terminal.app cannot be opened", async () => {
    const spawnTerm = mock(async (_cwd: string, _env: Record<string, string>, _command: string): Promise<void> => {
      throw new Error("Falha ao abrir Terminal.app no macOS (exit 1): osascript -e ...");
    });
    const deps = createDeps({ spawnTerm });
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
});
