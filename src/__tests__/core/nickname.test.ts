import { afterEach, describe, expect, mock, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { NsError, createSilentContext, normalizeNickname, readNickname, runSetNickname } from "../../core";
import { WORKTREES_DIR } from "../../lib/config";

function createMocks(exists = true) {
  return {
    branchExists: mock((_branch: string) => exists),
    write: mock((_path: string, _text: string) => Promise.resolve()),
    remove: mock((_path: string) => Promise.resolve()),
  };
}

const silent = createSilentContext();
const file = join(WORKTREES_DIR, "NS-1433", ".nickname");

describe("runSetNickname", () => {
  test("grava o Apelido sem os espaços das pontas, num arquivo da pasta da branch", async () => {
    const mocks = createMocks();

    const result = await runSetNickname({ branch: "NS-1433", nickname: "  Agenda recorrente " }, silent, mocks);

    expect(result).toEqual({ branch: "NS-1433", nickname: "Agenda recorrente" });
    expect(mocks.write).toHaveBeenCalledWith(file, "Agenda recorrente\n");
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  test("texto vazio ou só de espaços tira o Apelido", async () => {
    const mocks = createMocks();

    const result = await runSetNickname({ branch: "NS-1433", nickname: "   " }, silent, mocks);

    expect(result).toEqual({ branch: "NS-1433", nickname: null });
    expect(mocks.remove).toHaveBeenCalledWith(file);
    expect(mocks.write).not.toHaveBeenCalled();
  });

  test("conta caracteres como se veem: acento separado e emoji composto contam um", async () => {
    const mocks = createMocks();
    const forty = "a\u0301".repeat(20) + "👨‍👩‍👧".repeat(20);

    expect((await runSetNickname({ branch: "NS-1433", nickname: forty }, silent, mocks)).nickname).toBe(forty);
  });

  test("aceita 40 caracteres com acentos e recusa 41 como pre-condicao", async () => {
    const mocks = createMocks();
    const forty = "á".repeat(40);

    expect((await runSetNickname({ branch: "NS-1433", nickname: forty }, silent, mocks)).nickname).toBe(forty);
    const error = await runSetNickname({ branch: "NS-1433", nickname: `${forty}b` }, silent, mocks).catch((e) => e);

    expect(error).toBeInstanceOf(NsError);
    expect((error as NsError).category).toBe("pre-condicao");
    expect(mocks.write).toHaveBeenCalledTimes(1);
  });

  test("branch inexistente é nao-encontrado e nada é gravado", async () => {
    const mocks = createMocks(false);

    const error = await runSetNickname({ branch: "NS-9999", nickname: "x" }, silent, mocks).catch((e) => e);

    expect((error as NsError).category).toBe("nao-encontrado");
    expect(mocks.write).not.toHaveBeenCalled();
  });

  test("falha ao gravar vira ferramenta-externa", async () => {
    const mocks = { ...createMocks(), write: mock(() => Promise.reject(new Error("EACCES"))) };

    const error = await runSetNickname({ branch: "NS-1433", nickname: "x" }, silent, mocks).catch((e) => e);

    expect((error as NsError).category).toBe("ferramenta-externa");
  });
});

describe("normalizeNickname", () => {
  test("junta as linhas numa só e só descarta os espaços das pontas", () => {
    expect(normalizeNickname(" Agenda\nrecorrente  2\t")).toBe("Agenda recorrente  2");
  });
});

describe("readNickname", () => {
  const dir = join(WORKTREES_DIR, "nickname-read");

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test("lê o Apelido gravado e devolve null sem arquivo", async () => {
    mkdirSync(dir, { recursive: true });

    expect(await readNickname("nickname-read")).toBeNull();
    writeFileSync(join(dir, ".nickname"), "Agenda recorrente\n");
    expect(await readNickname("nickname-read")).toBe("Agenda recorrente");
  });
});
