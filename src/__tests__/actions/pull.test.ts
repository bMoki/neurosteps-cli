import { describe, test, expect, mock, afterEach } from "bun:test";
import { join } from "path";
import { pullAction, inferWorktreeFromCwd } from "../../actions/pull";
import { WORKTREES_DIR } from "../../lib/config";
import { createShellResult, TEST_BRANCH } from "../setup";
import type { ShellResult } from "../../lib/shell";

type GitHandler = (repo: string, args: string[]) => Partial<ShellResult> | undefined;

const repoPath = (repo: string) => join(WORKTREES_DIR, TEST_BRANCH, repo);

function createDeps(handler: GitHandler, repos = ["backend", "frontend"]) {
  const exec = mock((command: string[]) => {
    const path = command[2]!;
    const repo = path.split("/").pop()!;
    const args = command.slice(3);
    const override = handler(repo, args);
    if (override) return Promise.resolve(createShellResult(command, override));

    if (args[0] === "rev-parse") {
      return Promise.resolve(createShellResult(command, { stdout: "abc\n" }));
    }
    if (args[0] === "ls-remote") {
      return Promise.resolve(createShellResult(command, { stdout: `sha\trefs/heads/${args[3]}\n` }));
    }
    return Promise.resolve(createShellResult(command));
  });

  return {
    exec,
    cwd: mock(() => join(WORKTREES_DIR, TEST_BRANCH, "backend", "src")),
    listBranches: mock(() => [TEST_BRANCH, "other"]),
    branchExists: mock((branch: string) => branch === TEST_BRANCH || branch === "other"),
    pathExists: mock((path: string) => repos.some((r) => path.endsWith(`/${r}`))),
    promptBranch: mock(() => Promise.resolve(TEST_BRANCH)),
  };
}

const pullCalls = (deps: ReturnType<typeof createDeps>) =>
  deps.exec.mock.calls.map(([cmd]) => cmd).filter((cmd) => cmd[3] === "pull");

describe("pullAction", () => {
  afterEach(() => {
    process.exitCode = undefined;
  });

  test("pulls the given remote branch in every repo of the worktree inferred from cwd", async () => {
    const deps = createDeps(() => undefined);

    await pullAction("origin", "NS-1232", {}, deps);

    expect(pullCalls(deps)).toEqual([
      ["git", "-C", repoPath("backend"), "pull", "origin", "NS-1232"],
      ["git", "-C", repoPath("frontend"), "pull", "origin", "NS-1232"],
    ]);
    expect(deps.promptBranch).not.toHaveBeenCalled();
    expect(process.exitCode).not.toBe(1);
  });

  test("resolves @default per repo from origin/HEAD, falling back to main then master", async () => {
    const deps = createDeps((repo, args) => {
      if (args[0] === "symbolic-ref") {
        return repo === "backend" ? { stdout: "origin/master\n" } : { exitCode: 128 };
      }
      if (args[0] === "ls-remote" && repo === "frontend") {
        return { stdout: args[3] === "main" ? "sha\trefs/heads/main\n" : "" };
      }
      return undefined;
    });

    await pullAction("origin", "@default", {}, deps);

    expect(pullCalls(deps)).toEqual([
      ["git", "-C", repoPath("backend"), "pull", "origin", "master"],
      ["git", "-C", repoPath("frontend"), "pull", "origin", "main"],
    ]);
  });

  test("skips repos where the branch does not exist on the remote without failing", async () => {
    const deps = createDeps((repo, args) =>
      args[0] === "ls-remote" && repo === "frontend" ? { stdout: "" } : undefined,
    );

    await pullAction("origin", "NS-1232", {}, deps);

    expect(pullCalls(deps)).toEqual([["git", "-C", repoPath("backend"), "pull", "origin", "NS-1232"]]);
    expect(process.exitCode).not.toBe(1);
  });

  test("aborts when the branch does not exist in any repo", async () => {
    const deps = createDeps((_repo, args) => (args[0] === "ls-remote" ? { stdout: "" } : undefined));

    await expect(pullAction("origin", "NS-typo", {}, deps)).rejects.toThrow("não existe em origin em nenhum repo");
    expect(pullCalls(deps)).toEqual([]);
  });

  test("keeps pulling the other repos when one fails and sets exit code 1", async () => {
    const deps = createDeps((repo, args) =>
      args[0] === "pull" && repo === "backend" ? { exitCode: 1, stderr: "CONFLICT (content)" } : undefined,
    );

    await pullAction("origin", "NS-1232", {}, deps);

    expect(pullCalls(deps)).toHaveLength(2);
    expect(process.exitCode).toBe(1);
  });

  test("uses --branch instead of inferring from cwd", async () => {
    const deps = createDeps(() => undefined);

    await pullAction("origin", "NS-1232", { branch: "other" }, deps);

    expect(deps.pathExists).toHaveBeenCalledWith(join(WORKTREES_DIR, "other", "backend"));
  });

  test("prompts for the worktree when cwd is outside the worktrees dir", async () => {
    const deps = createDeps(() => undefined);
    deps.cwd = mock(() => "/tmp/elsewhere");

    await pullAction("origin", "NS-1232", {}, deps);

    expect(deps.promptBranch).toHaveBeenCalledWith([TEST_BRANCH, "other"]);
  });

  test("rejects an unknown --branch", async () => {
    const deps = createDeps(() => undefined);

    await expect(pullAction("origin", "NS-1232", { branch: "nope" }, deps)).rejects.toThrow("'nope' não encontrada");
  });
});

describe("inferWorktreeFromCwd", () => {
  test("returns the first segment below the worktrees dir", () => {
    expect(inferWorktreeFromCwd(join(WORKTREES_DIR, "feat-1", "frontend", "src"))).toBe("feat-1");
    expect(inferWorktreeFromCwd(join(WORKTREES_DIR, "feat-1"))).toBe("feat-1");
  });

  test("returns null outside the worktrees dir", () => {
    expect(inferWorktreeFromCwd(WORKTREES_DIR)).toBeNull();
    expect(inferWorktreeFromCwd("/tmp")).toBeNull();
  });
});
