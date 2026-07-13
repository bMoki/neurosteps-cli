import { describe, test, expect, mock } from "bun:test";
import { rmAction, rmFlaggedAction } from "../../actions/rm";
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
    hasDocsRepo: mock(() => true),
    confirm: mock(() => Promise.resolve(true)),
    rmDir: mock(() => Promise.resolve()),
    rmSnapshots: mock(() => Promise.resolve()),
  });

  test("removes branch with all services", async () => {
    const mocks = createMocks();
    await rmAction("feat-123", { force: true }, mocks);

    expect(mocks.readEnv).toHaveBeenCalledWith("feat-123");
    expect(mocks.composeDown).toHaveBeenCalled();
    expect(mocks.rmAlias).toHaveBeenCalledTimes(3);
    expect(mocks.rmWorktree).toHaveBeenCalledTimes(4);
    expect(mocks.rmWorktree.mock.calls.map((call) => call[2])).toEqual([
      { force: true },
      { force: true },
      { force: true },
      { force: true },
    ]);
    expect(mocks.delBranch).toHaveBeenCalledTimes(4);
    expect(mocks.rmDir).toHaveBeenCalledTimes(1);
  });

  test("removes volume when purge and force are true", async () => {
    const mocks = createMocks();
    await rmAction("feat-123", { purge: true, force: true }, mocks);

    expect(mocks.volumeRm).toHaveBeenCalledWith("myapp_db_feat-123");
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  test("purge without force still asks for confirmation", async () => {
    const mocks = createMocks();
    await rmAction("feat-123", { purge: true }, mocks);

    expect(mocks.confirm).toHaveBeenCalled();
    expect(mocks.volumeRm).toHaveBeenCalledWith("myapp_db_feat-123");
    expect(mocks.rmWorktree.mock.calls.map((call) => call[2])).toEqual([
      { force: false },
      { force: false },
      { force: false },
      { force: false },
    ]);
  });

  test("does not remove volume without purge flag", async () => {
    const mocks = createMocks();
    await rmAction("feat-123", { force: true }, mocks);

    expect(mocks.volumeRm).not.toHaveBeenCalled();
  });

  test("aborts when user cancels", async () => {
    const mocks = createMocks();
    mocks.confirm = mock(() => Promise.resolve(false));
    await rmAction("feat-123", {}, mocks);

    expect(mocks.composeDown).not.toHaveBeenCalled();
  });

  test("purge calls rmSnapshots for the branch", async () => {
    const mocks = createMocks();
    await rmAction("feat-123", { purge: true, force: true }, mocks);

    expect(mocks.rmSnapshots).toHaveBeenCalledWith("feat-123");
    expect(mocks.volumeRm).toHaveBeenCalledWith("myapp_db_feat-123");
  });

  test("non-purge does not call rmSnapshots", async () => {
    const mocks = createMocks();
    await rmAction("feat-123", { force: true }, mocks);

    expect(mocks.rmSnapshots).not.toHaveBeenCalled();
  });

  test("dry-run with purge does not call rmSnapshots or composeDown", async () => {
    const mocks = createMocks();
    await rmAction("feat-123", { purge: true, dryRun: true }, mocks);

    expect(mocks.rmSnapshots).not.toHaveBeenCalled();
    expect(mocks.composeDown).not.toHaveBeenCalled();
  });

  test("exits when branch not found", async () => {
    const mocks = createMocks();
    mocks.readEnv = mock(() => Promise.resolve(null as any));

    const originalExit = process.exit;
    process.exit = ((code: number) => { throw new ProcessExit(String(code)); }) as any;

    try {
      await rmAction("NONEXISTENT", {}, mocks);
      expect(false).toBe(true);
    } catch (e) {
      expect(e).toBeInstanceOf(ProcessExit);
    }

    process.exit = originalExit;
  });
});

describe("rmFlaggedAction", () => {
  test("removes only branches with the requested flag", async () => {
    const deps = {
      list: mock(() => ["active", "old-a", "old-b"]),
      listFlagged: mock(() => Promise.resolve(["old-a", "old-b"])),
      rm: mock(() => Promise.resolve()),
    };

    await rmFlaggedAction("stale", { force: true, purge: true }, deps);

    expect(deps.listFlagged).toHaveBeenCalledWith(["active", "old-a", "old-b"], "stale");
    expect(deps.rm).toHaveBeenCalledTimes(2);
    expect(deps.rm).toHaveBeenCalledWith("old-a", { force: true, purge: true });
    expect(deps.rm).toHaveBeenCalledWith("old-b", { force: true, purge: true });
  });

  test("does nothing when no branches are flagged", async () => {
    const deps = {
      list: mock(() => ["active"]),
      listFlagged: mock(() => Promise.resolve([])),
      rm: mock(() => Promise.resolve()),
    };

    await rmFlaggedAction("stale", {}, deps);

    expect(deps.rm).not.toHaveBeenCalled();
  });

  test("rejects unsupported flags", async () => {
    await expect(rmFlaggedAction("unknown", {}, {
      list: mock(() => []),
      listFlagged: mock(() => Promise.resolve([])),
      rm: mock(() => Promise.resolve()),
    })).rejects.toThrow("não suportada");
  });
});
