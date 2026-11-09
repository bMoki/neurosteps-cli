import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { NsError, createSilentContext, runDepsStatus, runInstallDeps } from "../../core";
import type { DepsOperationDeps, NsProgressEvent } from "../../core";
import { WORKTREES_DIR } from "../../lib/config";
import { createShellResult } from "../setup";

const branchDir = join(WORKTREES_DIR, "feat-deps");
const repoDirs = ["frontend", "manager", "report-server"].map((repo) => join(branchDir, repo));
const reused = (repo: string) => join(branchDir, repo, "node_modules/.ns-from-master");

function createDeps(present: (path: string) => boolean, overrides: Partial<DepsOperationDeps> = {}): Partial<DepsOperationDeps> {
  return {
    exists: mock((path: string) => path.endsWith(".workspace.env") || present(path)),
    hasManager: mock(() => true),
    hasReportServer: mock(() => true),
    installedMatchesLockfile: mock(() => true),
    run: mock((command: string[]) => Promise.resolve(createShellResult(command))),
    ...overrides,
  };
}

const installed = (path: string) => !path.endsWith(".ns-from-master");
const commands = (run: DepsOperationDeps["run"]) =>
  ((run as ReturnType<typeof mock>).mock.calls as [string[]][]).map(([command]) => command.join(" ").replace(/\S*\/worktrees\//g, ""));

beforeAll(() => repoDirs.forEach((dir) => mkdirSync(dir, { recursive: true })));
afterAll(() => rmSync(branchDir, { recursive: true, force: true }));

describe("runDepsStatus", () => {
  test("diz o estado de cada Repo com dependências e o comando para rodar à mão", async () => {
    const result = await runDepsStatus({ branch: "feat-deps" }, createSilentContext(), createDeps(
      (path) => !path.startsWith(join(branchDir, "report-server")) && path !== reused("frontend"),
    ));

    expect(result.repos.map(({ id, state, command }) => [id, state, command])).toEqual([
      ["frontend", "instaladas", "npm install"],
      ["manager", "da-master", "npm install"],
      ["report-server", "faltando", "bun install"],
    ]);
  });

  test("da master e diferentes do declarado são divergentes", async () => {
    const matches = mock((dir: string) => !dir.endsWith("frontend"));
    const result = await runDepsStatus({ branch: "feat-deps" }, createSilentContext(), createDeps(
      () => true,
      { installedMatchesLockfile: matches, hasManager: mock(() => false), hasReportServer: mock(() => false) },
    ));

    expect(result.repos.map(({ id, state }) => [id, state])).toEqual([["frontend", "da-master-divergentes"]]);
  });

  test("instalação da própria branch não é comparada com o declarado", async () => {
    const matches = mock(() => false);
    const result = await runDepsStatus({ branch: "feat-deps" }, createSilentContext(), createDeps(
      installed,
      { installedMatchesLockfile: matches },
    ));

    expect(result.repos.every(({ state }) => state === "instaladas")).toBe(true);
    expect(matches).not.toHaveBeenCalled();
  });

  test("branch sem worktree é nao-encontrado", async () => {
    const promise = runDepsStatus({ branch: "nao-existe" }, createSilentContext(), { exists: mock(() => false) });

    await expect(promise).rejects.toBeInstanceOf(NsError);
    await expect(promise).rejects.toMatchObject({ category: "nao-encontrado" });
  });
});

describe("runInstallDeps", () => {
  test("sobre as dependências da master instala as diferenças e tira a marca", async () => {
    let marked = true;
    const events: NsProgressEvent[] = [];
    const deps = createDeps((path) => marked || installed(path), {
      run: mock((command: string[]) => {
        if (command[0] === "rm") marked = false;
        return Promise.resolve(createShellResult(command));
      }),
    });

    const result = await runInstallDeps(
      { branch: "feat-deps", repo: "frontend" },
      { emit: (event) => events.push(event), ask: async () => true },
      deps,
    );

    expect(commands(deps.run!)).toEqual(["npm install", "rm -f feat-deps/frontend/node_modules/.ns-from-master"]);
    expect(events.map(({ step }) => step)).toEqual(["deps:install:frontend", "deps:install:frontend:done"]);
    expect(result).toMatchObject({ id: "frontend", state: "instaladas" });
  });

  test("sem dependências instala do zero, como Preparar", async () => {
    const deps = createDeps(() => false);

    await runInstallDeps({ branch: "feat-deps", repo: "report-server" }, createSilentContext(), deps);

    expect(commands(deps.run!)[0]).toBe("bun install");
  });

  test("npm ci que nem roda cai no npm install", async () => {
    const run = mock((command: string[]) =>
      command[1] === "ci" ? Promise.reject(new Error("spawn")) : Promise.resolve(createShellResult(command)));

    await runInstallDeps({ branch: "feat-deps", repo: "manager" }, createSilentContext(), createDeps(() => false, { run }));

    expect(commands(run).slice(0, 2)).toEqual(["npm ci", "npm install"]);
  });

  test("falha devolve o fim da saída do erro e o comando para rodar à mão", async () => {
    const stderr = Array.from({ length: 40 }, (_, line) => `linha ${line + 1}`).join("\n");
    const run = mock((command: string[]) => Promise.resolve(createShellResult(command, { exitCode: 1, stderr })));

    const promise = runInstallDeps({ branch: "feat-deps", repo: "frontend" }, createSilentContext(), createDeps(() => true, { run }));

    await expect(promise).rejects.toMatchObject({ category: "ferramenta-externa" });
    const error = (await promise.catch((caught: unknown) => caught)) as NsError;
    expect(error.message).toStartWith("Falha ao instalar as dependências do frontend (exit 1): npm install");
    expect(error.message).toContain("linha 40");
    expect(error.message).not.toContain("linha 20\n");
    expect(error.hint).toBe(`Rode manualmente: npm install em ${join(branchDir, "frontend")}`);
    expect(commands(run)).toEqual(["npm install"]);
  });

  test("Repo que a branch não tem é nao-encontrado", async () => {
    const promise = runInstallDeps(
      { branch: "feat-deps", repo: "manager" },
      createSilentContext(),
      createDeps(() => true, { hasManager: mock(() => false) }),
    );

    await expect(promise).rejects.toMatchObject({ category: "nao-encontrado" });
  });
});
