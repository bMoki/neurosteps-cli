import { describe, test, expect } from "bun:test";
import { execSync } from "../../lib/shell";

describe("shell extra", () => {
  test("execSync runs command", () => {
    const result = execSync(["echo", "hello"], { silent: true });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("hello");
  });
});
