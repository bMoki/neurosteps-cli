import { describe, expect, mock, test } from "bun:test";
import { join } from "path";
import { NsError, createSilentContext, runDbOpen } from "../../core";
import { WORKTREES_DIR } from "../../lib/config";

function createMocks(configured: string | null = "datagrip") {
  return {
    branchExists: mock((_branch: string) => true),
    configuredApp: mock(() => Promise.resolve(configured ?? undefined)),
    openApp: mock((_app: string, _path?: string) => Promise.resolve()),
    markTouched: mock((_branch: string, _source: string) => Promise.resolve()),
  };
}

const silent = createSilentContext();

describe("runDbOpen", () => {
  test("abre a branch no app de banco configurado", async () => {
    const mocks = createMocks();

    const result = await runDbOpen({ branch: "feat-123" }, silent, mocks);

    expect(result).toEqual({ branch: "feat-123", app: "DataGrip" });
    expect(mocks.openApp).toHaveBeenCalledWith("DataGrip", join(WORKTREES_DIR, "feat-123"));
    expect(mocks.markTouched).toHaveBeenCalledWith("feat-123", "open-db");
  });

  test("app informado vence o configurado e não consulta a configuração", async () => {
    const mocks = createMocks();

    const result = await runDbOpen({ branch: "feat-123", app: "tableplus" }, silent, mocks);

    expect(result.app).toBe("TablePlus");
    expect(mocks.configuredApp).not.toHaveBeenCalled();
  });

  test("app fora do registro é aberto pelo nome", async () => {
    const result = await runDbOpen({ branch: "feat-123" }, silent, createMocks("Postico 2"));

    expect(result.app).toBe("Postico 2");
  });

  test("sem app configurado é pre-condicao com o comando que resolve", async () => {
    const mocks = createMocks(null);

    const run = runDbOpen({ branch: "feat-123" }, silent, mocks);

    await run.catch((error: NsError) => {
      expect(error.category).toBe("pre-condicao");
      expect(error.hint).toContain("ns config set databaseApp");
    });
    await expect(run).rejects.toBeInstanceOf(NsError);
    expect(mocks.openApp).not.toHaveBeenCalled();
  });

  test("branch inexistente é nao-encontrado, antes de perguntar o app", async () => {
    const mocks = createMocks();
    mocks.branchExists = mock(() => false);

    const run = runDbOpen({ branch: "sumiu" }, silent, mocks);

    await run.catch((error: NsError) => expect(error.category).toBe("nao-encontrado"));
    await expect(run).rejects.toBeInstanceOf(NsError);
    expect(mocks.configuredApp).not.toHaveBeenCalled();
  });

  test("falha ao abrir o app vira ferramenta-externa", async () => {
    const mocks = createMocks();
    mocks.openApp = mock(() => Promise.reject(new Error("Unable to find application named 'DataGrip'")));

    const run = runDbOpen({ branch: "feat-123" }, silent, mocks);

    await run.catch((error: NsError) => expect(error.category).toBe("ferramenta-externa"));
    await expect(run).rejects.toThrow("Unable to find application");
  });
});
