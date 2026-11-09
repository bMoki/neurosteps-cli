import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { depsAction, installDepsAction } from "../../commands/deps";
import { createShellResult } from "../setup";

describe("ns deps", () => {
  let printed: string[] = [];
  let spy: ReturnType<typeof spyOn>;
  beforeEach(() => {
    printed = [];
    spy = spyOn(console, "error").mockImplementation((...args: unknown[]) => { printed.push(args.join(" ")); });
  });
  afterEach(() => spy.mockRestore());

  const deps = (present: (path: string) => boolean) => ({
    exists: mock((path: string) => path.endsWith(".workspace.env") || present(path)),
    hasManager: mock(() => false),
    hasReportServer: mock(() => true),
    installedMatchesLockfile: mock(() => false),
    run: mock((command: string[]) => Promise.resolve(createShellResult(command))),
  });

  test("mostra o estado por Repo e avisa dos que precisam instalar", async () => {
    await depsAction("feat-cli", deps((path) => path.includes("/frontend/")));

    const output = printed.join("\n");
    expect(output).toContain("Da master, divergentes");
    expect(output).toContain("Faltando");
    expect(output).toContain("report-server: sem dependências instaladas");
    expect(output).toContain("Instale com: ns deps feat-cli --install <repo>");
  });

  test("sem pendências não sugere instalar", async () => {
    await depsAction("feat-cli", deps((path) => !path.endsWith(".ns-from-master")));

    expect(printed.join("\n")).not.toContain("Instale com");
  });

  test("--install instala as dependências do Repo", async () => {
    const mocks = deps(() => false);
    await installDepsAction("feat-cli", "report-server", mocks);

    expect(mocks.run.mock.calls[0]?.[0]).toEqual(["bun", "install"]);
  });
});
