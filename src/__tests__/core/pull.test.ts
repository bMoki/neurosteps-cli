import { describe, expect, mock, test } from "bun:test";
import { join } from "path";
import { type NsProgressEvent, NsError, runPull } from "../../core";
import { WORKTREES_DIR } from "../../lib/config";
import type { ShellResult } from "../../lib/shell";
import { createShellResult } from "../setup";

type GitHandler = (repo: string, args: string[]) => Partial<ShellResult> | undefined;

function deps(handler: GitHandler, repos = ["backend", "manager", "docs"]) {
  const heads: Record<string, string> = {};
  const exec = mock((command: string[]) => {
    const repo = command[2]!.split("/").pop()!;
    const args = command.slice(3);
    const override = handler(repo, args);
    if (override) return Promise.resolve(createShellResult(command, override));
    if (args[0] === "symbolic-ref") return Promise.resolve(createShellResult(command, { stdout: "origin/master\n" }));
    if (args[0] === "rev-parse") return Promise.resolve(createShellResult(command, { stdout: `${heads[repo] ?? "a"}\n` }));
    if (args[0] === "pull") heads[repo] = "a";
    return Promise.resolve(createShellResult(command));
  });
  return {
    exec,
    branchExists: mock((branch: string) => branch === "feat"),
    pathExists: mock((path: string) => repos.some((repo) => path === join(WORKTREES_DIR, "feat", repo))),
  };
}

const silent = { emit() {}, ask: async () => true };

describe("runPull", () => {
  test("traz a branch principal de cada Repo e devolve o estado de cada um", async () => {
    let pulled = false;
    const events: NsProgressEvent[] = [];
    const result = await runPull({ branch: "feat" }, { ...silent, emit: (event) => events.push(event) }, deps((repo, args) => {
      if (repo !== "backend") return undefined;
      if (args[0] === "pull") { pulled = true; return {}; }
      if (args[0] === "rev-parse") return { stdout: pulled ? "b\n" : "a\n" };
      if (args[0] === "rev-list") return { stdout: "3\n" };
      return undefined;
    }));

    expect(result.branch).toBe("feat");
    expect(result.repos.map(({ repo, status, branch, commits }) => ({ repo, status, branch, commits }))).toEqual([
      { repo: "backend", status: "updated", branch: "master", commits: 3 },
      { repo: "manager", status: "up-to-date", branch: "master", commits: undefined },
      { repo: "docs", status: "up-to-date", branch: "master", commits: undefined },
    ]);
    expect(events.map((event) => event.step)).toEqual(["pull:repos"]);
  });

  test("conflito é distinto de falha, lista os arquivos e não desfaz o merge", async () => {
    const d = deps((repo, args) => {
      if (repo === "manager" && args[0] === "pull") return { exitCode: 1, stdout: "CONFLICT (content): Merge conflict in src/a.ts" };
      if (repo === "manager" && args[0] === "diff") return { stdout: "src/a.ts\nsrc/b.ts\n" };
      if (repo === "docs" && args[0] === "pull") return { exitCode: 1, stderr: "fatal: unable to access" };
      return undefined;
    });

    const { repos } = await runPull({ branch: "feat" }, silent, d);

    expect(repos.find((r) => r.repo === "manager")).toMatchObject({ status: "conflict", conflicts: ["src/a.ts", "src/b.ts"] });
    expect(repos.find((r) => r.repo === "docs")).toMatchObject({ status: "failed", message: "fatal: unable to access" });
    const gitArgs = d.exec.mock.calls.map(([command]) => command.slice(3).join(" "));
    expect(gitArgs.some((args) => args.includes("merge --abort") || args.includes("reset"))).toBe(false);
  });

  test("Repo sem branch principal no remoto é ignorado", async () => {
    const { repos } = await runPull({ branch: "feat" }, silent, deps((repo, args) => {
      if (repo !== "docs") return undefined;
      if (args[0] === "symbolic-ref") return { exitCode: 128 };
      if (args[0] === "ls-remote") return { stdout: "" };
      return undefined;
    }));

    expect(repos.find((r) => r.repo === "docs")).toMatchObject({ status: "skipped", message: "branch principal não encontrada em origin" });
  });

  test("branch inexistente é nao-encontrado", async () => {
    const run = runPull({ branch: "sumiu" }, silent, deps(() => undefined));

    await expect(run).rejects.toBeInstanceOf(NsError);
    await run.catch((error: NsError) => expect(error.category).toBe("nao-encontrado"));
  });

  test("branch sem nenhum Repo é pre-condicao", async () => {
    const run = runPull({ branch: "feat" }, silent, deps(() => undefined, []));

    await run.catch((error: NsError) => expect(error.category).toBe("pre-condicao"));
    await expect(run).rejects.toBeInstanceOf(NsError);
  });
});
