import { describe, test, expect, mock } from "bun:test";
import { stopAction } from "../../actions/stop";
import {
  createShellResult,
  createMockWorkspaceEnv,
  TEST_BACKEND_PORT,
  TEST_FRONTEND_PORT,
  TEST_MANAGER_PORT,
} from "../setup";

describe("stopAction", () => {
  const createMocks = (exec = mock((command: string[]) => Promise.resolve(createShellResult(command)))) => ({
    readEnv: mock(() => Promise.resolve(createMockWorkspaceEnv())),
    composeDown: mock(() => Promise.resolve()),
    rmAlias: mock(() => Promise.resolve()),
    exec,
  });

  test("kills backend, frontend and manager processes for the branch ports", async () => {
    const pidsByPort: Record<string, string> = {
      [`:${TEST_BACKEND_PORT}`]: "101\n102\n",
      [`:${TEST_FRONTEND_PORT}`]: "201\n",
      [`:${TEST_MANAGER_PORT}`]: "301\n",
    };
    const exec = mock((command: string[]) => {
      if (command[0] === "lsof") {
        return Promise.resolve(createShellResult(command, { stdout: pidsByPort[command[2]!] ?? "" }));
      }

      return Promise.resolve(createShellResult(command));
    });
    const mocks = createMocks(exec);

    await stopAction("feat-123", {}, mocks);

    expect(exec).toHaveBeenCalledWith(["lsof", "-ti", `:${TEST_BACKEND_PORT}`], { silent: true });
    expect(exec).toHaveBeenCalledWith(["lsof", "-ti", `:${TEST_FRONTEND_PORT}`], { silent: true });
    expect(exec).toHaveBeenCalledWith(["lsof", "-ti", `:${TEST_MANAGER_PORT}`], { silent: true });
    expect(exec).toHaveBeenCalledWith(["kill", "-9", "101"], { silent: true });
    expect(exec).toHaveBeenCalledWith(["kill", "-9", "102"], { silent: true });
    expect(exec).toHaveBeenCalledWith(["kill", "-9", "201"], { silent: true });
    expect(exec).toHaveBeenCalledWith(["kill", "-9", "301"], { silent: true });
  });

  test("with a service, stops only that service and keeps the database and aliases", async () => {
    const exec = mock((command: string[]) => Promise.resolve(command[0] === "lsof"
      ? createShellResult(command, { stdout: "201\n" })
      : createShellResult(command)));
    const mocks = createMocks(exec);

    await stopAction("feat-123", { service: "frontend" }, mocks);

    expect(exec.mock.calls.map(([command]) => command)).toEqual([
      ["tmux", "kill-session", "-t", "=ns-feat-123-frontend"],
      ["lsof", "-ti", `:${TEST_FRONTEND_PORT}`],
      ["kill", "-9", "201"],
    ]);
    expect(mocks.composeDown).not.toHaveBeenCalled();
    expect(mocks.rmAlias).not.toHaveBeenCalled();
  });

  test("does not treat an empty lsof result as an error", async () => {
    const exec = mock((command: string[]) => {
      if (command[0] === "lsof") {
        return Promise.resolve(createShellResult(command, { exitCode: 1 }));
      }

      return Promise.resolve(createShellResult(command));
    });
    const mocks = createMocks(exec);

    await stopAction("feat-123", {}, mocks);

    const commands = exec.mock.calls.map(([command]) => command);
    expect(commands).not.toContainEqual(["kill", "-9", "101"]);
    expect(commands.filter((command) => command[0] === "lsof")).toHaveLength(3);
  });

  test("throws on lsof failure output and does not kill processes", async () => {
    const exec = mock((command: string[]) => {
      if (command[0] === "lsof") {
        return Promise.resolve(createShellResult(command, { exitCode: 2, stderr: "lsof failed" }));
      }

      return Promise.resolve(createShellResult(command));
    });
    const mocks = createMocks(exec);

    await expect(stopAction("feat-123", {}, mocks)).rejects.toThrow(
      `Falha ao listar processos na porta ${TEST_BACKEND_PORT}`,
    );

    const commands = exec.mock.calls.map(([command]) => command);
    expect(commands).not.toContainEqual(["kill", "-9", "101"]);
    expect(commands.filter((command) => command[0] === "lsof")).toHaveLength(1);
  });

  test("derruba as sessões tmux dos serviços antes de matar por porta", async () => {
    const mocks = createMocks();

    await stopAction("feat-123", {}, mocks);

    const commands = mocks.exec.mock.calls.map(([command]) => command);
    const sessions = commands.filter((command) => command[0] === "tmux");
    expect(sessions).toEqual([
      ["tmux", "kill-session", "-t", "=ns-feat-123-backend"],
      ["tmux", "kill-session", "-t", "=ns-feat-123-frontend"],
      ["tmux", "kill-session", "-t", "=ns-feat-123-manager"],
      ["tmux", "kill-session", "-t", "=ns-feat-123-report-server"],
    ]);
    expect(commands.findIndex((command) => command[0] === "lsof"))
      .toBeGreaterThan(commands.findLastIndex((command) => command[0] === "tmux"));
  });

  test("segue parando por porta quando o tmux não está instalado", async () => {
    const exec = mock((command: string[]) => {
      if (command[0] === "tmux") return Promise.reject(new Error("ENOENT: tmux"));
      return Promise.resolve(createShellResult(command));
    });

    await stopAction("feat-123", {}, createMocks(exec));

    expect(exec).toHaveBeenCalledWith(["lsof", "-ti", `:${TEST_BACKEND_PORT}`], { silent: true });
  });
});
