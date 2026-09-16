import { describe, expect, test } from "bun:test";
import type { Ora } from "ora";
import type { NsQuestion } from "../../core";
import { NsError } from "../../core";
import { createTerminalContext } from "../../lib/terminal-context";

function fakeSpinner() {
  const calls: string[] = [];
  const spinner = {
    text: "",
    isSpinning: true,
    stop() {
      this.isSpinning = false;
      calls.push("stop");
      return this;
    },
    start() {
      this.isSpinning = true;
      calls.push("start");
      return this;
    },
  };
  return { spinner: spinner as unknown as Ora, state: spinner, calls };
}

function question(overrides: Partial<NsQuestion> = {}): NsQuestion {
  return {
    id: "start.install-deps.frontend",
    message: "Instalar dependências do frontend?",
    default: true,
    whenUnavailable: "default",
    ...overrides,
  };
}

describe("createTerminalContext.emit", () => {
  test("escreve o label no spinner", () => {
    const { spinner, state } = fakeSpinner();
    const ctx = createTerminalContext(spinner);

    ctx.emit({ step: "database:start", label: "Iniciando PostgreSQL..." });

    expect(state.text).toContain("Iniciando PostgreSQL...");
  });

  test("prefixa o progresso quando index e total vêm juntos", () => {
    const { spinner, state } = fakeSpinner();
    const ctx = createTerminalContext(spinner);

    ctx.emit({ step: "backend:build", label: "Compilando...", index: 2, total: 5 });

    expect(state.text).toContain("[2/5] Compilando...");
  });
});

describe("createTerminalContext.ask", () => {
  test("pergunta usando o default declarado", async () => {
    const { spinner } = fakeSpinner();
    const seen: Array<{ message: string; default?: boolean }> = [];
    const ctx = createTerminalContext(spinner, {
      canPrompt: () => true,
      confirm: async (message, _deps, options) => {
        seen.push({ message, default: options?.default });
        return true;
      },
    });

    const answer = await ctx.ask(question({ default: true }));

    expect(answer).toBe(true);
    expect(seen).toEqual([{ message: "Instalar dependências do frontend?", default: true }]);
  });

  test("pausa e retoma o spinner ao redor do prompt", async () => {
    const { spinner, state, calls } = fakeSpinner();
    const ctx = createTerminalContext(spinner, {
      canPrompt: () => true,
      confirm: async () => {
        expect(state.isSpinning).toBe(false);
        return false;
      },
    });

    await ctx.ask(question());

    expect(calls).toEqual(["stop", "start"]);
    expect(state.isSpinning).toBe(true);
  });

  test("retoma o spinner mesmo quando o prompt lança", async () => {
    const { spinner, calls } = fakeSpinner();
    const ctx = createTerminalContext(spinner, {
      canPrompt: () => true,
      confirm: async () => {
        throw new Error("ctrl-c");
      },
    });

    await expect(ctx.ask(question())).rejects.toThrow("ctrl-c");
    expect(calls).toEqual(["stop", "start"]);
  });

  test("não mexe no spinner parado", async () => {
    const { spinner, state, calls } = fakeSpinner();
    state.isSpinning = false;
    const ctx = createTerminalContext(spinner, {
      canPrompt: () => true,
      confirm: async () => true,
    });

    await ctx.ask(question());

    expect(calls).toEqual([]);
  });

  test("sem quem responda, aplica whenUnavailable 'default'", async () => {
    const { spinner } = fakeSpinner();
    const ctx = createTerminalContext(spinner, {
      canPrompt: () => false,
      confirm: async () => {
        throw new Error("não deveria perguntar");
      },
    });

    expect(await ctx.ask(question({ default: true }))).toBe(true);
    expect(await ctx.ask(question({ default: false }))).toBe(false);
  });

  test("sem quem responda, aplica whenUnavailable 'abort'", async () => {
    const { spinner } = fakeSpinner();
    const ctx = createTerminalContext(spinner, {
      canPrompt: () => false,
      confirm: async () => true,
    });

    await expect(ctx.ask(question({ whenUnavailable: "abort" }))).rejects.toBeInstanceOf(NsError);
  });
});
