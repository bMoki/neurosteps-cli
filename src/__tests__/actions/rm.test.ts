import { describe, test, expect, mock } from "bun:test";
import { rmAction } from "../../actions/rm";
import { createMockWorkspaceEnv } from "../setup";

class ProcessExit extends Error {}

describe("rmAction", () => {
  const createMocks = () => ({
    readEnv: mock(() => Promise.resolve(createMockWorkspaceEnv())),
    composeDown: mock(() => Promise.resolve()),
    volumeRm: mock(() => Promise.resolve()),
    rmAlias: mock(() => Promise.resolve()),
    rmWorktree: mock(() => Promise.resolve()),
    delBranch: mock(() => Promise.resolve()),
    hasMgr: mock(() => true),
    confirm: mock(() => Promise.resolve(true)),
  });

  test("removes branch with all services", async () => {
    const mocks = createMocks();
    await rmAction("feat-123", false, mocks);

    expect(mocks.readEnv).toHaveBeenCalledWith("feat-123");
    expect(mocks.composeDown).toHaveBeenCalled();
    expect(mocks.rmAlias).toHaveBeenCalledTimes(3);
    expect(mocks.rmWorktree).toHaveBeenCalledTimes(3);
    expect(mocks.delBranch).toHaveBeenCalledTimes(3);
  });

  test("removes volume when purge is true", async () => {
    const mocks = createMocks();
    mocks.confirm = mock(() => Promise.resolve(false)); // Should not be called
    await rmAction("feat-123", true, mocks);

    expect(mocks.volumeRm).toHaveBeenCalledWith("myapp_db_feat-123");
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  test("aborts when user cancels", async () => {
    const mocks = createMocks();
    mocks.confirm = mock(() => Promise.resolve(false));
    await rmAction("feat-123", false, mocks);

    expect(mocks.composeDown).not.toHaveBeenCalled();
  });

  test("exits when branch not found", async () => {
    const mocks = createMocks();
    mocks.readEnv = mock(() => Promise.resolve(null as any));

    const originalExit = process.exit;
    process.exit = ((code: number) => { throw new ProcessExit(String(code)); }) as any;

    try {
      await rmAction("NONEXISTENT", false, mocks);
      expect(false).toBe(true);
    } catch (e) {
      expect(e).toBeInstanceOf(ProcessExit);
    }

    process.exit = originalExit;
  });
});
