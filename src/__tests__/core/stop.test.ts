import { describe, expect, mock, test } from "bun:test";
import { type NsProgressEvent, NsError, runStop } from "../../core";
import { createMockWorkspaceEnv, mockBunShell } from "../setup";

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
});
