import { describe, test, expect } from "bun:test";
import { exec, execChecked, execSync } from "../../lib/shell";

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
});
