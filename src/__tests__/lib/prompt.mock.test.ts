import { describe, test, expect, mock } from "bun:test";
import { confirm } from "../../lib/prompt";

describe("prompt with injected deps", () => {
  test("confirm uses injected implementation", async () => {
    const confirmMock = mock(() => Promise.resolve(true));
    const result = await confirm("Are you sure?", { confirm: confirmMock });
    expect(result).toBe(true);
    expect(confirmMock).toHaveBeenCalled();
  });
});
