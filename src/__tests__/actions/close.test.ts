import { describe, test, expect, mock } from "bun:test";
import { closeAction } from "../../actions/close";
import {
  createShellResult,
  createMockWorkspaceEnv,
  TEST_BACKEND_PORT,
  TEST_FRONTEND_PORT,
  TEST_MANAGER_PORT,
} from "../setup";

describe("closeAction", () => {
  test("shuts down branch services before closing the IDE window", async () => {
    const events: string[] = [];
    const pidsByPort: Record<string, string> = {
      [`:${TEST_BACKEND_PORT}`]: "101\n",
      [`:${TEST_FRONTEND_PORT}`]: "201\n",
      [`:${TEST_MANAGER_PORT}`]: "301\n",
    };
    const exec = mock((command: string[]) => {
      events.push(command.join(" "));
      if (command[0] === "lsof") {
        return Promise.resolve(createShellResult(command, { stdout: pidsByPort[command[2]!] ?? "" }));
      }

      return Promise.resolve(createShellResult(command));
    });
    const execChecked = mock((command: string[]) => {
      events.push(command[0]!);
      return Promise.resolve(createShellResult(command));
    });

    await closeAction("feat-123", { app: "vscode" }, {
      readEnv: mock(() => Promise.resolve(createMockWorkspaceEnv())),
      composeDown: mock(() => {
        events.push("composeDown");
        return Promise.resolve();
      }),
      rmAlias: mock((alias: string) => {
        events.push(`rmAlias:${alias}`);
        return Promise.resolve();
      }),
      exec,
      execChecked,
      resolveDefaultIde: mock(() => Promise.resolve("intellij")),
      resolveAppPath: mock(() => Promise.resolve("/Applications/Visual Studio Code.app")),
      appDisplayName: mock(() => "Visual Studio Code"),
    });

    expect(events).toContain("composeDown");
    expect(events).toContain("rmAlias:feat-123.web.neurosteps");
    expect(events).toContain("rmAlias:feat-123.api.neurosteps");
    expect(events).toContain("rmAlias:feat-123.manager.neurosteps");
    expect(exec).toHaveBeenCalledWith(["kill", "-9", "101"], { silent: true });
    expect(exec).toHaveBeenCalledWith(["kill", "-9", "201"], { silent: true });
    expect(exec).toHaveBeenCalledWith(["kill", "-9", "301"], { silent: true });
    expect(execChecked).toHaveBeenCalledWith(
      [
        "osascript",
        "-e",
        'tell application "Visual Studio Code" to close (every window whose name contains "feat-123")',
      ],
      { silent: true },
      "fechar janelas do Visual Studio Code no macOS",
    );
    expect(events.at(-1)).toBe("osascript");
  });

  test("uses the default IDE when no app is provided", async () => {
    const resolveDefaultIde = mock(() => Promise.resolve("vscode"));
    const resolveAppPath = mock(() => Promise.resolve(null));
    const appDisplayName = mock((key: string) => key);

    await closeAction("feat-123", {}, {
      readEnv: mock(() => Promise.resolve(createMockWorkspaceEnv({ MANAGER_PORT: undefined }))),
      composeDown: mock(() => Promise.resolve()),
      rmAlias: mock(() => Promise.resolve()),
      exec: mock((command: string[]) => Promise.resolve(createShellResult(command, { exitCode: 1 }))),
      execChecked: mock((command: string[]) => Promise.resolve(createShellResult(command))),
      resolveDefaultIde,
      resolveAppPath,
      appDisplayName,
    });

    expect(resolveDefaultIde).toHaveBeenCalled();
    expect(resolveAppPath).toHaveBeenCalledWith("vscode");
    expect(appDisplayName).toHaveBeenCalledWith("vscode");
  });
});
