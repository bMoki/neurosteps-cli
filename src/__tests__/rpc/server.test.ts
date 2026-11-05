import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { type PrepareResult, type ServicePlan, type StatusResult, conflito } from "../../core";
import { createShellResult } from "../setup";
import { type RpcOperations, createRpcOperations, withInput } from "../../rpc/operations";
import type { RpcOutgoing } from "../../rpc/protocol";
import { createRpcServer } from "../../rpc/server";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

function startServer(operations: RpcOperations) {
  const out: RpcOutgoing[] = [];
  const server = createRpcServer(operations, { write: (message) => out.push(message) });
  const send = (message: unknown) => server.receive(JSON.stringify(message));
  const settle = () => new Promise((r) => setTimeout(r, 0));
  const messagesOf = (id: string) => out.filter((m) => "id" in m && m.id === id);
  return { out, server, send, settle, messagesOf };
}

const STATUS: StatusResult = { baseRepos: [], branches: [] };
const PREPARED: PrepareResult = {
  branch: "feat",
  ports: { db: 5438, backend: 8084, frontend: 3015 },
  urls: { backend: "https://feat.api", frontend: "https://feat.web" },
  services: [],
  depsInstalled: [],
  depsMissing: [],
};

describe("ns rpc: protocolo", () => {
  test("anuncia a versão do protocolo e as operações disponíveis", () => {
    const { out, server } = startServer(createRpcOperations({ runStatus: async () => STATUS }));

    server.ready();

    expect(out).toEqual([{ type: "ready", protocol: 1, ops: ["status", "prepare", "start", "stop"] }]);
  });

  test("status devolve o resultado do núcleo correlacionado ao id, repassando o input e o progresso", async () => {
    const calls: unknown[] = [];
    const { send, settle, out } = startServer(createRpcOperations({
      runStatus: async (input, ctx) => {
        calls.push(input);
        ctx.emit({ step: "status:branch", label: "Lendo status de feat...", index: 1, total: 1 });
        return STATUS;
      },
    }));

    send({ type: "op", id: "r1", op: "status", input: { branch: "feat" } });
    await settle();

    expect(calls).toEqual([{ branch: "feat" }]);
    expect(out).toEqual([
      { type: "event", id: "r1", event: { step: "status:branch", label: "Lendo status de feat...", index: 1, total: 1 } },
      { type: "result", id: "r1", result: STATUS },
    ]);
  });

  test("status sem input lê todas as branches", async () => {
    const calls: unknown[] = [];
    const { send, settle } = startServer(createRpcOperations({ runStatus: async (input) => { calls.push(input); return STATUS; } }));

    send({ type: "op", id: "r1", op: "status" });
    await settle();

    expect(calls).toEqual([{}]);
  });

  test("prepare repassa o input, as perguntas ao cliente e devolve o plano", async () => {
    const calls: unknown[] = [];
    const { send, settle, out } = startServer(createRpcOperations({
      runPrepare: async (input, ctx) => {
        calls.push(input);
        ctx.emit({ step: "database:start", label: "Iniciando PostgreSQL..." });
        await ctx.ask({
          id: "prepare.install-deps.frontend",
          message: "Instalar?",
          default: true,
          whenUnavailable: "default",
        });
        return PREPARED;
      },
    }));

    send({ type: "op", id: "r1", op: "prepare", input: { branch: "feat", withManager: false } });
    await settle();
    const ask = out.find((m) => m.type === "ask");
    send({ type: "answer", id: "r1", ask: ask?.type === "ask" ? ask.ask : "", value: false });
    await settle();

    expect(calls).toEqual([{ branch: "feat", withManager: false, installMissingDeps: "ask" }]);
    expect(out.map((m) => m.type)).toEqual(["event", "ask", "result"]);
    expect(out.at(-1)).toEqual({ type: "result", id: "r1", result: PREPARED });
  });

  test("prepare sem branch ou com política desconhecida é recusado", async () => {
    let called = false;
    const { send, settle, messagesOf } = startServer(createRpcOperations({
      runPrepare: async () => { called = true; return PREPARED; },
    }));

    send({ type: "op", id: "r1", op: "prepare", input: {} });
    send({ type: "op", id: "r2", op: "prepare", input: { branch: "feat", installMissingDeps: "talvez" } });
    await settle();

    expect(called).toBe(false);
    for (const id of ["r1", "r2"]) {
      const [message] = messagesOf(id);
      expect(message?.type === "error" && message.error.category).toBe("protocolo");
    }
  });

  test("start prepara e sobe numa sessão tmux cada Serviço que ainda não atende na porta", async () => {
    const service: ServicePlan = {
      id: "backend", label: "Backend", cwd: "/wt/feat/backend", env: {}, command: "mvn quarkus:dev",
      port: 8084, session: "ns-feat-backend", logFile: "/tmp/ns-rpc-test/feat/backend.log",
    };
    const tmux: string[][] = [];
    const prepared: unknown[] = [];
    const { send, settle, out } = startServer(createRpcOperations({
      runPrepare: async (input) => {
        prepared.push(input);
        return { ...PREPARED, services: [service, { ...service, id: "frontend", label: "Frontend", port: 3015, session: "ns-feat-frontend" }] };
      },
      runTmux: async (command) => {
        tmux.push(command);
        return command[1] === "display-message"
          ? createShellResult(command, { exitCode: 1 })
          : createShellResult(command);
      },
      listListeningPorts: async () => new Set([3015]),
    }));

    send({ type: "op", id: "r1", op: "start", input: { branch: "feat", installMissingDeps: "always" } });
    await new Promise((r) => setTimeout(r, 20));
    await settle();

    expect(prepared).toEqual([{ branch: "feat", installMissingDeps: "always" }]);
    expect(tmux.map((command) => command[1])).toEqual(["-V", "display-message", "new-session"]);
    expect(out).toContainEqual({ type: "event", id: "r1", event: { step: "start:backend", label: "Iniciando Backend..." } });
    expect(out.some((m) => m.type === "event" && m.event.step === "start:frontend")).toBe(false);
    expect(out.at(-1)).toMatchObject({ type: "result", id: "r1" });
  });

  test("start sem tmux é pre-condicao e nem prepara a branch", async () => {
    let called = false;
    const { send, settle, messagesOf } = startServer(createRpcOperations({
      runPrepare: async () => { called = true; return PREPARED; },
      runTmux: async () => { throw new Error("ENOENT"); },
    }));

    send({ type: "op", id: "r1", op: "start", input: { branch: "feat" } });
    await settle();
    await settle();

    expect(called).toBe(false);
    const [message] = messagesOf("r1");
    expect(message?.type === "error" && message.error.category).toBe("pre-condicao");
  });

  test("stop repassa a branch ao núcleo", async () => {
    const calls: unknown[] = [];
    const { send, settle, out } = startServer(createRpcOperations({
      runStop: async (input) => { calls.push(input); return { branch: input.branch }; },
    }));

    send({ type: "op", id: "r1", op: "stop", input: { branch: "feat" } });
    await settle();

    expect(calls).toEqual([{ branch: "feat" }]);
    expect(out).toEqual([{ type: "result", id: "r1", result: { branch: "feat" } }]);
  });

  test("linha que não é JSON vira erro de protocolo sem id e o servidor segue atendendo", async () => {
    const { server, send, settle, out } = startServer(createRpcOperations({ runStatus: async () => STATUS }));

    server.receive("{ isto não é json");
    send({ type: "op", id: "r2", op: "status" });
    await settle();

    expect(out[0]).toEqual({ type: "error", id: null, error: { category: "protocolo", message: "A linha recebida não é JSON válido." } });
    expect(out[1]).toEqual({ type: "result", id: "r2", result: STATUS });
  });

  test("mensagem com formato inválido devolve erro de protocolo com o id, quando há", () => {
    const { send, out } = startServer({});

    send({ type: "op", id: "r1" });
    send({ type: "cancelar", id: "r2" });

    expect(out.map((m) => m.type === "error" && [m.id, m.error.category])).toEqual([["r1", "protocolo"], ["r2", "protocolo"]]);
  });

  test("operação desconhecida devolve erro de protocolo listando as disponíveis", () => {
    const { send, out } = startServer(createRpcOperations({ runStatus: async () => STATUS }));

    send({ type: "op", id: "r1", op: "deploy" });
    send({ type: "op", id: "r2", op: "toString" });

    expect(out).toEqual([
      { type: "error", id: "r1", error: { category: "protocolo", message: "Operação desconhecida: 'deploy'.", hint: "Operações disponíveis: status, prepare, start, stop." } },
      { type: "error", id: "r2", error: { category: "protocolo", message: "Operação desconhecida: 'toString'.", hint: "Operações disponíveis: status, prepare, start, stop." } },
    ]);
  });

  test("input inválido para a operação é recusado antes de chegar ao núcleo", async () => {
    let called = false;
    const { send, settle, messagesOf } = startServer(createRpcOperations({ runStatus: async () => { called = true; return STATUS; } }));

    send({ type: "op", id: "r1", op: "status", input: { branch: 42 } });
    send({ type: "op", id: "r2", op: "status", input: { branch: "feat", force: true } });
    await settle();

    expect(called).toBe(false);
    for (const id of ["r1", "r2"]) {
      const [message] = messagesOf(id);
      expect(message?.type === "error" && message.error.category).toBe("protocolo");
    }
  });

  test("erro do núcleo chega com a categoria, a mensagem e a dica", async () => {
    const { send, settle, out } = startServer({ falha: async () => { throw conflito("Porta 5432 ocupada", "Pare o outro banco."); } });

    send({ type: "op", id: "r1", op: "falha" });
    await settle();

    expect(out).toEqual([{ type: "error", id: "r1", error: { category: "conflito", message: "Porta 5432 ocupada", hint: "Pare o outro banco." } }]);
  });

  test("erro inesperado vira categoria interno e é registrado", async () => {
    const logged: unknown[] = [];
    const out: RpcOutgoing[] = [];
    const boom = new Error("boom");
    const server = createRpcServer({ quebra: async () => { throw boom; } }, { write: (m) => out.push(m), logError: (e) => logged.push(e) });

    server.receive(JSON.stringify({ type: "op", id: "r1", op: "quebra" }));
    await server.end();

    expect(out).toEqual([{ type: "error", id: "r1", error: { category: "interno", message: "boom" } }]);
    expect(logged).toEqual([boom]);
  });

  test("resultado ausente vai como null", async () => {
    const { send, settle, out } = startServer({ nada: async () => undefined });

    send({ type: "op", id: "r1", op: "nada" });
    await settle();

    expect(out).toEqual([{ type: "result", id: "r1", result: null }]);
  });

  test("resultado que não vira JSON devolve erro interno e o servidor segue atendendo", async () => {
    const lines: string[] = [];
    const server = createRpcServer(
      { grande: async () => ({ total: 1n }), eco: async (input) => input },
      { write: (message) => lines.push(JSON.stringify(message)), logError: () => {} },
    );

    server.receive(JSON.stringify({ type: "op", id: "r1", op: "grande" }));
    server.receive(JSON.stringify({ type: "op", id: "r2", op: "eco", input: 2 }));
    await server.end();

    const messages = lines.map((line) => JSON.parse(line));
    expect(messages).toHaveLength(2);
    expect(messages).toContainEqual({ type: "error", id: "r1", error: { category: "interno", message: "O resultado da operação não pôde ser enviado." } });
    expect(messages).toContainEqual({ type: "result", id: "r2", result: 2 });
  });

  test("id repetido enquanto a primeira requisição está em andamento é recusado", async () => {
    const gate = deferred<void>();
    const { send, settle, messagesOf } = startServer({ lenta: async () => { await gate.promise; return "ok"; } });

    send({ type: "op", id: "r1", op: "lenta" });
    send({ type: "op", id: "r1", op: "lenta" });
    gate.resolve();
    await settle();

    expect(messagesOf("r1").map((m) => m.type)).toEqual(["error", "result"]);
  });

  test("um id pode ser reutilizado depois que a requisição termina", async () => {
    const { send, settle, messagesOf } = startServer({ eco: async (input) => input });

    send({ type: "op", id: "r1", op: "eco", input: 1 });
    await settle();
    send({ type: "op", id: "r1", op: "eco", input: 2 });
    await settle();

    expect(messagesOf("r1")).toEqual([{ type: "result", id: "r1", result: 1 }, { type: "result", id: "r1", result: 2 }]);
  });
});

describe("ns rpc: perguntas", () => {
  const pergunta = (whenUnavailable: "abort" | "default") =>
    withInput(z.object({}), async (_input, ctx) =>
      ctx.ask({ id: "start.install-deps.frontend", message: "Instalar dependências?", default: true, whenUnavailable }));

  test("a pergunta vai para o cliente e a operação espera a resposta", async () => {
    const { send, settle, out } = startServer({ pergunta: pergunta("abort") });

    send({ type: "op", id: "r1", op: "pergunta" });
    await settle();
    expect(out).toEqual([{
      type: "ask",
      id: "r1",
      ask: "a1",
      question: { id: "start.install-deps.frontend", message: "Instalar dependências?", default: true, whenUnavailable: "abort" },
    }]);

    send({ type: "answer", id: "r1", ask: "a1", value: false });
    await settle();
    expect(out[1]).toEqual({ type: "result", id: "r1", result: false });
  });

  test("resposta a uma pergunta que não está pendente é erro de protocolo", async () => {
    const { send, settle, messagesOf } = startServer({ pergunta: pergunta("abort") });

    send({ type: "op", id: "r1", op: "pergunta" });
    await settle();
    send({ type: "answer", id: "r2", ask: "a1", value: true });
    send({ type: "answer", id: "r1", ask: "a9", value: true });

    expect(messagesOf("r2")[0]?.type).toBe("error");
    expect(messagesOf("r1").map((m) => m.type)).toEqual(["ask", "error"]);
  });

  test("se o cliente encerra, a pergunta com whenUnavailable 'default' segue com o padrão", async () => {
    const { server, send, settle, out } = startServer({ pergunta: pergunta("default") });

    send({ type: "op", id: "r1", op: "pergunta" });
    await settle();
    await server.end();

    expect(out.at(-1)).toEqual({ type: "result", id: "r1", result: true });
  });

  test("se o cliente encerra, a pergunta com whenUnavailable 'abort' cancela a operação", async () => {
    const { server, send, settle, out } = startServer({ pergunta: pergunta("abort") });

    send({ type: "op", id: "r1", op: "pergunta" });
    await settle();
    await server.end();

    const last = out.at(-1);
    expect(last?.type === "error" && last.error.category).toBe("cancelado");
  });

  test("depois de o cliente encerrar, a pergunta 'abort' rejeita a promessa em vez de lançar", async () => {
    const gate = deferred<void>();
    const op = withInput(z.object({}), async (_input, ctx) => {
      await gate.promise;
      return ctx.ask({ id: "q", message: "Seguir?", default: false, whenUnavailable: "abort" }).catch(() => "rejeitou");
    });
    const { server, send, out } = startServer({ op });

    send({ type: "op", id: "r1", op: "op" });
    const ending = server.end();
    gate.resolve();
    await ending;

    expect(out).toEqual([{ type: "result", id: "r1", result: "rejeitou" }]);
  });

  test("pergunta feita depois de o cliente encerrar não é enviada", async () => {
    const gate = deferred<void>();
    const op = withInput(z.object({}), async (_input, ctx) => {
      await gate.promise;
      return ctx.ask({ id: "q", message: "Seguir?", default: false, whenUnavailable: "default" });
    });
    const { server, send, out } = startServer({ op });

    send({ type: "op", id: "r1", op: "op" });
    const ending = server.end();
    gate.resolve();
    await ending;

    expect(out).toEqual([{ type: "result", id: "r1", result: false }]);
  });
});

describe("ns rpc: concorrência", () => {
  test("requisições simultâneas não misturam eventos, perguntas nem resultados", async () => {
    const gate = deferred<void>();
    const lenta = withInput(z.object({}), async (_input, ctx) => {
      ctx.emit({ step: "lenta:1", label: "lenta começou" });
      await gate.promise;
      const sim = await ctx.ask({ id: "q", message: "Seguir?", default: false, whenUnavailable: "abort" });
      return { lenta: sim };
    });
    const rapida = withInput(z.object({}), async (_input, ctx) => {
      ctx.emit({ step: "rapida:1", label: "rápida começou" });
      return { rapida: true };
    });
    const { send, settle, messagesOf } = startServer({ lenta, rapida });

    send({ type: "op", id: "A", op: "lenta" });
    send({ type: "op", id: "B", op: "rapida" });
    await settle();
    gate.resolve();
    await settle();
    send({ type: "answer", id: "A", ask: "a1", value: true });
    await settle();

    expect(messagesOf("A")).toEqual([
      { type: "event", id: "A", event: { step: "lenta:1", label: "lenta começou" } },
      { type: "ask", id: "A", ask: "a1", question: { id: "q", message: "Seguir?", default: false, whenUnavailable: "abort" } },
      { type: "result", id: "A", result: { lenta: true } },
    ]);
    expect(messagesOf("B")).toEqual([
      { type: "event", id: "B", event: { step: "rapida:1", label: "rápida começou" } },
      { type: "result", id: "B", result: { rapida: true } },
    ]);
  });

  test("end espera as operações em andamento terminarem", async () => {
    const gate = deferred<void>();
    const { server, send, out } = startServer({ lenta: async () => { await gate.promise; return "fim"; } });

    send({ type: "op", id: "r1", op: "lenta" });
    const ending = server.end();
    setTimeout(() => gate.resolve(), 5);
    await ending;

    expect(out).toEqual([{ type: "result", id: "r1", result: "fim" }]);
  });
});
