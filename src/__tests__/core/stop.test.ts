import { describe, expect, mock, test } from "bun:test";
import { type NsProgressEvent, NsError, runStop } from "../../core";
import { TEST_BACKEND_PORT, createMockWorkspaceEnv, createShellResult, mockBunShell } from "../setup";

type Env = ReturnType<typeof createMockWorkspaceEnv>;

function deps(overrides: Record<string, unknown> = {}) {
  return {
    readEnv: mock(() => Promise.resolve(createMockWorkspaceEnv() as Env)),
    composeDown: mock(() => Promise.resolve()),
    rmAlias: mock(() => Promise.resolve()),
    exec: mockBunShell(),
    ...overrides,
  } as never;
}

describe("runStop", () => {
  test("para a branch avisando cada passo", async () => {
    const events: NsProgressEvent[] = [];
    const result = await runStop({ branch: "feat-123" }, {
      emit: (event) => events.push(event),
      ask: async () => true,
    }, deps());

    expect(result).toEqual({ branch: "feat-123" });
    expect(events.map((event) => event.step)).toEqual(["database:stop", "portless:aliases", "processes:stop"]);
  });

  test("branch sem worktree é nao-encontrado", async () => {
    const run = runStop({ branch: "sumiu" }, { emit() {}, ask: async () => true }, deps({
      readEnv: mock(() => Promise.resolve(null)),
    }));

    await expect(run).rejects.toBeInstanceOf(NsError);
    await run.catch((error: NsError) => expect(error.category).toBe("nao-encontrado"));
  });

  test("falha do docker vira ferramenta-externa", async () => {
    const run = runStop({ branch: "feat-123" }, { emit() {}, ask: async () => true }, deps({
      composeDown: mock(() => Promise.reject(new Error("docker fora"))),
    }));

    await run.catch((error: NsError) => {
      expect(error.category).toBe("ferramenta-externa");
      expect(error.message).toBe("docker fora");
    });
  });

  test("com service, para só aquele Serviço: a sessão dele e o que atende na porta dele", async () => {
    const events: NsProgressEvent[] = [];
    const composeDown = mock(() => Promise.resolve());
    const rmAlias = mock(() => Promise.resolve());
    const exec = mock((command: string[]) => Promise.resolve(command[0] === "lsof"
      ? createShellResult(command, { stdout: "101\n" })
      : createShellResult(command)));

    await runStop({ branch: "feat-123", service: "backend" }, {
      emit: (event) => events.push(event),
      ask: async () => true,
    }, deps({ composeDown, rmAlias, exec }));

    expect(exec.mock.calls.map(([command]) => command)).toEqual([
      ["tmux", "kill-session", "-t", "=ns-feat-123-backend"],
      ["lsof", "-ti", `:${TEST_BACKEND_PORT}`],
      ["kill", "-9", "101"],
    ]);
    expect(composeDown).not.toHaveBeenCalled();
    expect(rmAlias).not.toHaveBeenCalled();
    expect(events).toEqual([{ step: "processes:stop", label: "Parando backend..." }]);
  });

  test("Serviço que a branch não tem é nao-encontrado", async () => {
    const run = runStop({ branch: "feat-123", service: "report-server" }, { emit() {}, ask: async () => true }, deps({
      readEnv: mock(() => Promise.resolve(createMockWorkspaceEnv({ REPORT_SERVER_PORT: undefined }) as Env)),
    }));

    await run.then(() => { throw new Error("devia falhar"); }, (error: NsError) => {
      expect(error.category).toBe("nao-encontrado");
      expect(error.message).toBe("A branch 'feat-123' não tem o Serviço report-server");
    });
  });
});
