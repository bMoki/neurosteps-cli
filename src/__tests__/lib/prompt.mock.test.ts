import { describe, test, expect, mock } from "bun:test";
import { confirm } from "../../lib/prompt";

describe("prompt with injected deps", () => {
  test("confirm uses injected implementation", async () => {
    const confirmMock = mock(() => Promise.resolve(true));
    const result = await confirm("Are you sure?", { confirm: confirmMock });
    expect(result).toBe(true);
    expect(confirmMock).toHaveBeenCalled();
  });

  test("confirm rejects when --no-input is enabled", async () => {
    const original = process.env.NS_NO_INPUT;
    try {
      process.env.NS_NO_INPUT = "1";
      await expect(confirm("Are you sure?")).rejects.toThrow("--no-input");
    } finally {
      if (original === undefined) {
        delete process.env.NS_NO_INPUT;
      } else {
        process.env.NS_NO_INPUT = original;
      }
    }
  });
});
