import { describe, expect, test } from "bun:test";
import type { NsQuestion } from "../../core";
import { NsError, applyWhenUnavailable, createSilentContext } from "../../core";

function question(overrides: Partial<NsQuestion> = {}): NsQuestion {
  return {
    id: "start.install-deps.frontend",
    message: "Instalar dependências do frontend?",
    default: true,
    whenUnavailable: "default",
    ...overrides,
  };
}

describe("applyWhenUnavailable", () => {
  test("'default' resolve com o default da pergunta", () => {
    expect(applyWhenUnavailable(question({ default: true }))).toBe(true);
    expect(applyWhenUnavailable(question({ default: false }))).toBe(false);
  });

  test("'abort' lança NsError da categoria cancelado", () => {
    try {
      applyWhenUnavailable(question({ whenUnavailable: "abort" }));
      throw new Error("deveria ter lançado");
    } catch (err) {
      expect(err).toBeInstanceOf(NsError);
      expect((err as NsError).category).toBe("cancelado");
      expect((err as NsError).message).toContain("Instalar dependências do frontend?");
      expect((err as NsError).hint).toBeTruthy();
    }
  });
});

describe("createSilentContext", () => {
  test("descarta eventos sem lançar", () => {
    const ctx = createSilentContext();

    expect(() => ctx.emit({ step: "database:start", label: "Iniciando PostgreSQL..." })).not.toThrow();
  });

  test("ask aplica whenUnavailable 'default'", async () => {
    const ctx = createSilentContext();

    expect(await ctx.ask(question({ default: false }))).toBe(false);
    expect(await ctx.ask(question({ default: true }))).toBe(true);
  });

  test("ask rejeita com cancelado quando whenUnavailable é 'abort'", async () => {
    const ctx = createSilentContext();

    const result = ctx.ask(question({ whenUnavailable: "abort" }));

    await expect(result).rejects.toBeInstanceOf(NsError);
  });
});
