import { describe, expect, test } from "bun:test";
import {
  NsError,
  cancelado,
  conflito,
  ferramentaExterna,
  isNsError,
  naoEncontrado,
  preCondicao,
} from "../../core";

describe("NsError", () => {
  test("carrega categoria, hint e cause", () => {
    const original = new Error("git falhou");
    const err = new NsError("ferramenta-externa", "git worktree add falhou", {
      hint: "Rode com --debug",
      cause: original,
    });

    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("NsError");
    expect(err.category).toBe("ferramenta-externa");
    expect(err.message).toBe("git worktree add falhou");
    expect(err.hint).toBe("Rode com --debug");
    expect(err.cause).toBe(original);
  });

  test("hint é opcional", () => {
    expect(new NsError("conflito", "já existe").hint).toBeUndefined();
  });

  test("isNsError distingue de Error comum", () => {
    expect(isNsError(new NsError("cancelado", "x"))).toBe(true);
    expect(isNsError(new Error("x"))).toBe(false);
    expect(isNsError("x")).toBe(false);
  });
});

describe("helpers por categoria", () => {
  test("cada helper aplica a sua categoria", () => {
    expect(naoEncontrado("a").category).toBe("nao-encontrado");
    expect(conflito("a").category).toBe("conflito");
    expect(preCondicao("a").category).toBe("pre-condicao");
    expect(ferramentaExterna("a").category).toBe("ferramenta-externa");
    expect(cancelado("a").category).toBe("cancelado");
  });

  test("string no segundo argumento vira hint", () => {
    const err = naoEncontrado("branch não existe", "Rode 'ns status'");

    expect(err.hint).toBe("Rode 'ns status'");
  });

  test("objeto no segundo argumento passa hint e cause", () => {
    const original = new Error("exit 128");
    const err = ferramentaExterna("git falhou", { hint: "Verifique o repo", cause: original });

    expect(err.hint).toBe("Verifique o repo");
    expect(err.cause).toBe(original);
  });
});
