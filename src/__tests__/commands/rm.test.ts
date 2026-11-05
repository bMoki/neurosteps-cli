import { describe, test, expect, mock } from "bun:test";
import { join } from "path";
import { rmAction, rmFlaggedAction } from "../../commands/rm";
import { WORKTREES_DIR } from "../../lib/config";
import { createMockWorkspaceEnv, createShellResult } from "../setup";

describe("rmAction", () => {
  const createMocks = (dirty = "") => ({
    readEnv: mock((_branch: string) => Promise.resolve(createMockWorkspaceEnv() as any)),
    pathExists: mock((path: string) => ["backend", "frontend"].some((repo) => path === join(WORKTREES_DIR, "feat-123", repo))),
    exec: mock((command: string[]) => Promise.resolve(createShellResult(command, { stdout: command[2]!.endsWith("backend") ? dirty : "" }))),
    stopSessions: mock((_slug: string) => Promise.resolve()),
    composeDown: mock(() => Promise.resolve()),
    volumeRm: mock(() => Promise.resolve()),
    rmAlias: mock(() => Promise.resolve()),
    rmWorktree: mock((_repo: string, _path: string, _opts?: { force?: boolean }) => Promise.resolve()),
    delBranch: mock(() => Promise.resolve()),
    rmSnapshots: mock(() => Promise.resolve()),
    rmDir: mock(() => Promise.resolve()),
    confirm: mock(() => Promise.resolve(true)),
  });

  test("pede confirmação e remove", async () => {
    const mocks = createMocks();
    await rmAction("feat-123", {}, mocks);

    expect(mocks.confirm).toHaveBeenCalled();
    expect(mocks.rmDir).toHaveBeenCalledWith(join(WORKTREES_DIR, "feat-123"));
  });

  test("aborts when user cancels", async () => {
    const mocks = createMocks();
    mocks.confirm = mock(() => Promise.resolve(false));
    await rmAction("feat-123", {}, mocks);

    expect(mocks.composeDown).not.toHaveBeenCalled();
  });

  test("com alterações não commitadas recusa antes de perguntar", async () => {
    const mocks = createMocks(" M src/A.java\n");

    await expect(rmAction("feat-123", { purge: true }, mocks)).rejects.toMatchObject({ hint: expect.stringContaining("--force") });

    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(mocks.composeDown).not.toHaveBeenCalled();
    expect(mocks.volumeRm).not.toHaveBeenCalled();
  });

  test("force pula a confirmação e remove mesmo com alterações", async () => {
    const mocks = createMocks(" M src/A.java\n");
    await rmAction("feat-123", { force: true, purge: true }, mocks);

    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(mocks.volumeRm).toHaveBeenCalledWith("myapp_db_feat-123");
    expect(mocks.rmWorktree.mock.calls.map((call) => call[2])).toEqual([{ force: true }, { force: true }]);
  });

  test("dry-run não remove nada", async () => {
    const mocks = createMocks();
    await rmAction("feat-123", { purge: true, dryRun: true }, mocks);

    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(mocks.rmSnapshots).not.toHaveBeenCalled();
    expect(mocks.composeDown).not.toHaveBeenCalled();
  });

  test("branch inexistente é nao-encontrado", async () => {
    const mocks = createMocks();
    mocks.readEnv = mock(() => Promise.resolve(null));

    await expect(rmAction("NONEXISTENT", {}, mocks)).rejects.toThrow("não encontrada");
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
