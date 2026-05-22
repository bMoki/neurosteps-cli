import { describe, test, expect, mock } from "bun:test";
import { exec, execChecked, execSync, formatShellCommand, spawnTerminal } from "../../lib/shell";

describe("shell", () => {
  test("exec runs command and returns result", async () => {
    const result = await exec(["echo", "hello"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(""); // Not silent, so no capture
  });

  test("execSync runs command synchronously", () => {
    const result = execSync(["echo", "hello"], { silent: true });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("hello");
  });

  test("execChecked throws standardized error on failure", async () => {
    await expect(execChecked(["sh", "-c", "exit 7"], { silent: true }, "testar falha")).rejects.toThrow(
      "Falha ao testar falha (exit 7)",
    );
  });

  test("formatShellCommand quotes cwd and env values without unsafe double quotes", () => {
    const command = formatShellCommand(
      "/tmp/work tree",
      {
        PORT: "8084",
        JDBC_URL: "jdbc:postgresql://localhost:5439/teste_postgres",
        PASSWORD: "do'cker",
      },
      "npm start",
    );

    expect(command).toContain("cd '/tmp/work tree'");
    expect(command).toContain("export PORT=8084");
    expect(command).toContain("export JDBC_URL=jdbc:postgresql://localhost:5439/teste_postgres");
    expect(command).toContain("export PASSWORD='do'\\''cker'");
    expect(command).not.toContain('PORT="8084"');
  });

  test("spawnTerminal escapes the shell command before embedding it in AppleScript", async () => {
    const originalSpawn = Bun.spawn;
    const calls: string[][] = [];
    Bun.spawn = mock((command: string[]) => {
      calls.push(command);
      return {
        exited: Promise.resolve(0),
        stdout: new ReadableStream({ start(c) { c.close(); } }),
        stderr: new ReadableStream({ start(c) { c.close(); } }),
      };
    }) as any;

    try {
      await spawnTerminal("/tmp/work tree", { PORT: "8084", NAME: 'a "quote"' }, "npm start");
    } finally {
      Bun.spawn = originalSpawn;
    }

    const script = calls[0]?.[2] ?? "";
    expect(calls[0]?.[0]).toBe("osascript");
    expect(script).toContain("do script ");
    expect(script).toContain("cd '/tmp/work tree'");
    expect(script).toContain("export PORT=8084");
    expect(script).toContain("export NAME='a \\\"quote\\\"'");
    expect(script).not.toContain('export PORT="8084"');
  });
});
