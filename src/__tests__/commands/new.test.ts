import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { newCommand } from "../../commands/branch";
import { addRepoAction } from "../../commands/add";
import { type NewDeps, naoEncontrado } from "../../core";
import { createShellResult } from "../setup";

const prepared = {
  branch: "feat-123",
  ports: { db: 5438, backend: 8084, frontend: 3015 },
  urls: { backend: "https://feat-123.api", frontend: "https://feat-123.web" },
  services: [],
  depsInstalled: [],
  depsMissing: [],
};

const createDeps = (): Partial<NewDeps> => ({
  branchExistsOrigin: mock((_repo: string, branch: string) => Promise.resolve(branch === "master" || branch === "develop")),
  fetch: mock(() => Promise.resolve()),
  trackBranch: mock(() => Promise.resolve()),
  localBranch: mock(() => Promise.resolve()),
  localExists: mock(() => false),
  worktree: mock(() => Promise.resolve()),
  allocate: mock(() => ({ db: 5438, backend: 8084, backendDebug: 5005, management: 9001, frontend: 3015 })),
  copyTpl: mock(() => Promise.resolve()),
  volumeCreate: mock(() => Promise.resolve()),
  volumeCopy: mock(() => Promise.resolve()),
  shell: mock((cmd: string[]) => Promise.resolve(createShellResult(cmd))),
  markTouched: mock(() => Promise.resolve()),
  hooks: mock(() => Promise.resolve()),
  addRepo: mock(() => Promise.reject(naoEncontrado("Branch base 'origin/main' não existe no parents"))),
  prepare: mock(() => Promise.resolve(prepared)),
});

describe("ns new", () => {
  let printed: string[];
  const originalFile = Bun.file;

  beforeEach(() => {
    printed = [];
    spyOn(console, "error").mockImplementation((...args: unknown[]) => { printed.push(args.join(" ")); });
    Bun.file = mock((path: string) => ({
      exists: () => Promise.resolve(path.includes(".git") || !path.includes("worktrees") || path.includes("templates")),
      text: () => Promise.resolve(""),
    })) as any;
  });

  afterEach(() => {
    Bun.file = originalFile;
    mock.restore();
  });

  test("--with inclui os Repos pedidos e um Repo que falha vira aviso com o comando para repetir", async () => {
    const deps = createDeps();

    await newCommand(deps).parseAsync(["feat-123", "--no-manager", "--with", "parents", "develop"], { from: "user" });

    expect(deps.allocate).toHaveBeenCalledWith(false);
    expect(deps.localBranch).toHaveBeenCalledWith(expect.any(String), "feat-123", "origin/develop");
    expect(deps.addRepo).toHaveBeenCalledWith({ branch: "feat-123", repo: "parents" }, expect.anything());
    expect(deps.prepare).toHaveBeenCalledWith({ branch: "feat-123", installMissingDeps: "always" }, expect.anything());
    const output = printed.join("\n");
    expect(output).toContain("Branch base 'origin/main' não existe no parents");
    expect(output).toContain("Para tentar de novo: ns add parents feat-123");
  });

  test("--with recusa um Repo que não é opcional", async () => {
    const deps = createDeps();
    const command = newCommand(deps).exitOverride().configureOutput({ writeErr: () => {} });

    await expect(command.parseAsync(["feat-123", "--with", "docs"], { from: "user" })).rejects.toThrow();
    expect(deps.worktree).not.toHaveBeenCalled();
  });
});

describe("ns add", () => {
  test("erro do núcleo sobe com a categoria para o tratamento global", async () => {
    spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(addRepoAction("NS-927", "parents", {}, { readEnv: mock(() => Promise.resolve(null)) as never }))
        .rejects.toMatchObject({ category: "nao-encontrado" });
    } finally {
      mock.restore();
    }
  });
});
