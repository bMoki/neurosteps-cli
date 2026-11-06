import { type NsContext, type NsQuestion, applyWhenUnavailable, isNsError } from "../core";
import { RpcInputError, type RpcOperations } from "./operations";
import {
  PROTOCOL_VERSION,
  type RpcErrorBody,
  type RpcErrorCategory,
  type RpcIncoming,
  type RpcOutgoing,
  describeIssues,
  incomingMessage,
} from "./protocol";

export interface RpcServerDeps {
  write: (message: RpcOutgoing) => void;
  logError?: (error: unknown) => void;
}

export interface RpcServer {
  ready(): void;
  receive(line: string): void;
  /** O cliente fechou a entrada: perguntas pendentes caem no `whenUnavailable` e as operações terminam. */
  end(): Promise<void>;
}

interface PendingAsk {
  requestId: string;
  question: NsQuestion;
  resolve: (value: boolean) => void;
  reject: (error: unknown) => void;
}

export function createRpcServer(operations: RpcOperations, deps: RpcServerDeps): RpcServer {
  const { write, logError = () => {} } = deps;
  const inFlight = new Map<string, Promise<void>>();
  const pendingAsks = new Map<string, PendingAsk>();
  let nextAsk = 0;
  let closed = false;

  const protocolError = (id: string | null, message: string, hint?: string) =>
    write({ type: "error", id, error: errorBody("protocolo", message, hint) });

  function contextFor(requestId: string): NsContext {
    return {
      emit(event) {
        write({ type: "event", id: requestId, event });
      },
      async ask(question) {
        if (closed) {
          return applyWhenUnavailable(question);
        }
        const ask = `a${++nextAsk}`;
        return new Promise<boolean>((resolve, reject) => {
          pendingAsks.set(ask, { requestId, question, resolve, reject });
          write({ type: "ask", id: requestId, ask, question });
        });
      },
    };
  }

  function start(message: Extract<RpcIncoming, { type: "op" }>): void {
    const { id } = message;
    if (inFlight.has(id)) {
      protocolError(id, `Já existe uma requisição em andamento com o id '${id}'.`);
      return;
    }
    const operation = Object.hasOwn(operations, message.op) ? operations[message.op] : undefined;
    if (!operation) {
      protocolError(id, `Operação desconhecida: '${message.op}'.`, `Operações disponíveis: ${Object.keys(operations).join(", ")}.`);
      return;
    }

    const running = operation(message.input, contextFor(id))
      .then(
        (result) => write({ type: "result", id, result: result ?? null }),
        (error) => write({ type: "error", id, error: toErrorBody(error, logError) }),
      )
      // Um resultado que não vira JSON não pode deixar a requisição sem resposta nem derrubar o processo.
      .catch((error) => {
        logError(error);
        write({ type: "error", id, error: errorBody("interno", "O resultado da operação não pôde ser enviado.") });
      })
      .finally(() => inFlight.delete(id));
    inFlight.set(id, running);
  }

  function answer(message: Extract<RpcIncoming, { type: "answer" }>): void {
    const pending = pendingAsks.get(message.ask);
    if (!pending || pending.requestId !== message.id) {
      protocolError(message.id, `Nenhuma pergunta pendente '${message.ask}' na requisição '${message.id}'.`);
      return;
    }
    pendingAsks.delete(message.ask);
    pending.resolve(message.value);
  }

  return {
    ready() {
      write({ type: "ready", protocol: PROTOCOL_VERSION, ops: Object.keys(operations) });
    },

    receive(line) {
      if (!line.trim()) return;

      let raw: unknown;
      try {
        raw = JSON.parse(line);
      } catch {
        protocolError(null, "A linha recebida não é JSON válido.");
        return;
      }

      const parsed = incomingMessage.safeParse(raw);
      if (!parsed.success) {
        protocolError(idOf(raw), `Mensagem inválida: ${describeIssues(parsed.error)}`);
        return;
      }

      if (parsed.data.type === "op") start(parsed.data);
      else answer(parsed.data);
    },

    async end() {
      closed = true;
      for (const pending of pendingAsks.values()) {
        try {
          pending.resolve(applyWhenUnavailable(pending.question));
        } catch (error) {
          pending.reject(error);
        }
      }
      pendingAsks.clear();
      await Promise.all(inFlight.values());
    },
  };
}

function toErrorBody(error: unknown, logError: (error: unknown) => void): RpcErrorBody {
  if (isNsError(error)) {
    return errorBody(error.category, error.message, error.hint);
  }
  if (error instanceof RpcInputError) {
    return errorBody("protocolo", error.message);
  }
  logError(error);
  return errorBody("interno", error instanceof Error ? error.message : String(error));
}

function errorBody(category: RpcErrorCategory, message: string, hint?: string): RpcErrorBody {
  return hint ? { category, message, hint } : { category, message };
}

function idOf(raw: unknown): string | null {
  if (typeof raw === "object" && raw !== null && "id" in raw && typeof raw.id === "string" && raw.id) {
    return raw.id;
  }
  return null;
}
