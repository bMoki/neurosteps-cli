import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { readCheckedOutBranch } from "../../lib/git";

let root: string | undefined;

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

function folder(): string {
  root = mkdtempSync(join(tmpdir(), "ns-checked-out-"));
  return root;
}

describe("readCheckedOutBranch", () => {
  test("lê a branch de um clone comum", async () => {
    const repo = folder();
    mkdirSync(join(repo, ".git"));
    writeFileSync(join(repo, ".git", "HEAD"), "ref: refs/heads/feat/abc\n");

    expect(await readCheckedOutBranch(repo)).toBe("feat/abc");
  });

  test("segue o .git de uma worktree até a pasta do git dela", async () => {
    const base = folder();
    const gitDir = join(base, "main", ".git", "worktrees", "backend");
    const repo = join(base, "wt", "backend");
    mkdirSync(gitDir, { recursive: true });
    mkdirSync(repo, { recursive: true });
    writeFileSync(join(gitDir, "HEAD"), "ref: refs/heads/trocada-a-mao\n");
    writeFileSync(join(repo, ".git"), "gitdir: ../../main/.git/worktrees/backend\n");

    expect(await readCheckedOutBranch(repo)).toBe("trocada-a-mao");
  });

  test("HEAD destacado e Repo sem git dão null", async () => {
    const repo = folder();
    mkdirSync(join(repo, "detached", ".git"), { recursive: true });
    writeFileSync(join(repo, "detached", ".git", "HEAD"), "3f2a9c1e0b7d4a5f6e8c9b0a1d2e3f4a5b6c7d8e\n");
    mkdirSync(join(repo, "plain"));

    expect(await readCheckedOutBranch(join(repo, "detached"))).toBeNull();
    expect(await readCheckedOutBranch(join(repo, "plain"))).toBeNull();
  });

  test("lê a branch de uma worktree de verdade criada pelo git", async () => {
    const base = folder();
    const main = join(base, "main");
    const git = (...args: string[]) => {
      const result = Bun.spawnSync(["git", ...args], { cwd: main, stdout: "ignore", stderr: "pipe" });
      if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr.toString()}`);
    };
    mkdirSync(main);
    git("init", "-q", "-b", "main");
    git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "x");
    git("worktree", "add", "-q", "-b", "feat-1", join(base, "wt"));
    expect(await readCheckedOutBranch(join(base, "wt"))).toBe("feat-1");

    git("-C", join(base, "wt"), "checkout", "-q", "-b", "outra");
    expect(await readCheckedOutBranch(join(base, "wt"))).toBe("outra");
  });
});
