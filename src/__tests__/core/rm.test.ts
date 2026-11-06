import { describe, expect, mock, test } from "bun:test";
import { join } from "path";
import { type NsProgressEvent, NsError, createSilentContext, runRm, runRmPreview } from "../../core";
import { STATE_DIR, WORKTREES_DIR } from "../../lib/config";
import { createMockWorkspaceEnv, createShellResult } from "../setup";

const branchDir = join(WORKTREES_DIR, "feat-123");

function createMocks(dirty: Record<string, string> = {}, repos = ["backend", "frontend", "docs", "manager"]) {
  return {
    readEnv: mock((_branch: string) => Promise.resolve(createMockWorkspaceEnv() as any)),
    pathExists: mock((path: string) => repos.some((repo) => path === join(branchDir, repo))),
    exec: mock((command: string[]) => {
      const repo = command[2]!.split("/").pop()!;
      return Promise.resolve(createShellResult(command, { stdout: dirty[repo] ?? "" }));
    }),
    stopSessions: mock((_slug: string) => Promise.resolve()),
    composeDown: mock(() => Promise.resolve()),
    volumeRm: mock((_volume: string) => Promise.resolve()),
    rmAlias: mock((_alias: string) => Promise.resolve()),
    rmWorktree: mock((_repo: string, _path: string, _opts?: { force?: boolean }) => Promise.resolve()),
    delBranch: mock((_repo: string, _branch: string) => Promise.resolve()),
    rmSnapshots: mock((_branch: string) => Promise.resolve()),
    rmDir: mock((_path: string) => Promise.resolve()),
  };
}

const silent = createSilentContext();

describe("runRmPreview", () => {
  test("lista os Repos da branch e os que têm alterações não commitadas", async () => {
    const mocks = createMocks({ backend: " M src/A.java\0?? dir/com espaço.txt\0R  novo.ts\0velho.ts\0", docs: "" });

    const preview = await runRmPreview({ branch: "feat-123" }, silent, mocks);

    expect(preview).toEqual({
      branch: "feat-123",
      path: branchDir,
      repos: ["backend", "frontend", "docs", "manager"],
      volume: "myapp_db_feat-123",
      uncommitted: [{ repo: "backend", files: ["src/A.java", "dir/com espaço.txt", "novo.ts"] }],
    });
  });

  test("branch inexistente é nao-encontrado", async () => {
    const mocks = createMocks();
    mocks.readEnv = mock(() => Promise.resolve(null));

    const run = runRmPreview({ branch: "sumiu" }, silent, mocks);

    await run.catch((error: NsError) => expect(error.category).toBe("nao-encontrado"));
    await expect(run).rejects.toBeInstanceOf(NsError);
  });
});

describe("runRm", () => {
  test("remove a branch inteira e preserva o volume do banco", async () => {
    const mocks = createMocks();
    const events: NsProgressEvent[] = [];

    const result = await runRm({ branch: "feat-123" }, { ...silent, emit: (event) => events.push(event) }, mocks);

    expect(result).toEqual({ branch: "feat-123", purged: false });
    expect(mocks.stopSessions).toHaveBeenCalledWith("feat-123");
    expect(mocks.composeDown).toHaveBeenCalled();
    expect(mocks.rmAlias).toHaveBeenCalledTimes(3);
    expect(mocks.rmWorktree.mock.calls.map(([, path, opts]) => [path, opts])).toEqual(
      ["backend", "frontend", "docs", "manager"].map((repo) => [join(branchDir, repo), { force: false }]),
    );
    expect(mocks.delBranch).toHaveBeenCalledTimes(4);
    expect(mocks.volumeRm).not.toHaveBeenCalled();
    expect(mocks.rmSnapshots).not.toHaveBeenCalled();
    expect(mocks.rmDir.mock.calls.map(([path]) => path)).toEqual([join(STATE_DIR, "feat-123"), branchDir]);
    expect(events.map(({ step }) => step)).toEqual(["rm:stop", "rm:aliases", "rm:worktrees", "rm:branches", "rm:logs", "rm:dir"]);
  });

  test("com purge apaga também o volume e os snapshots", async () => {
    const mocks = createMocks();

    const result = await runRm({ branch: "feat-123", purge: true }, silent, mocks);

    expect(result.purged).toBe(true);
    expect(mocks.volumeRm).toHaveBeenCalledWith("myapp_db_feat-123");
    expect(mocks.rmSnapshots).toHaveBeenCalledWith("feat-123");
  });

  test("alterações não commitadas bloqueiam a remoção antes de tocar em qualquer coisa", async () => {
    const mocks = createMocks({ manager: " M a.ts\0 M b.ts\0" });

    const run = runRm({ branch: "feat-123", purge: true }, silent, mocks);

    await expect(run).rejects.toThrow("alterações não commitadas em manager (2 arquivos)");
    await run.catch((error: NsError) => {
      expect(error.category).toBe("pre-condicao");
      expect(error.hint).not.toContain("--force");
    });
    expect(mocks.stopSessions).not.toHaveBeenCalled();
    expect(mocks.composeDown).not.toHaveBeenCalled();
    expect(mocks.volumeRm).not.toHaveBeenCalled();
    expect(mocks.rmWorktree).not.toHaveBeenCalled();
  });

  test("com force remove mesmo com alterações não commitadas", async () => {
    const mocks = createMocks({ backend: " M a.ts\n" });

    await runRm({ branch: "feat-123", force: true }, silent, mocks);

    expect(mocks.exec).not.toHaveBeenCalled();
    expect(mocks.rmWorktree.mock.calls.every(([, , opts]) => opts?.force === true)).toBe(true);
  });

  test("falha de um passo vira ferramenta-externa", async () => {
    const mocks = createMocks();
    mocks.composeDown = mock(() => Promise.reject(new Error("docker parado")));

    const run = runRm({ branch: "feat-123" }, silent, mocks);

    await run.catch((error: NsError) => expect(error.category).toBe("ferramenta-externa"));
    await expect(run).rejects.toThrow("docker parado");
  });
});
