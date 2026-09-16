import { cancelado } from "./errors";

export interface NsProgressEvent {
  step: string;     // id estável, ex.: "database:start" — para o adapter correlacionar
  label: string;    // texto pronto para humano, ex.: "Iniciando PostgreSQL..."
  index?: number;   // opcional: passo atual
  total?: number;   // opcional: total de passos
}

export interface NsQuestion {
  id: string;                              // ex.: "start.install-deps.frontend"
  message: string;
  default: boolean;
  whenUnavailable: "abort" | "default";    // o que fazer quando não há quem responda
}

export interface NsContext {
  emit(event: NsProgressEvent): void;
  ask(question: NsQuestion): Promise<boolean>;
}

/**
 * Política declarada pela pergunta, aplicada por quem implementa o `ctx`.
 * O núcleo nunca inspeciona o ambiente para decidir isto.
 */
export function applyWhenUnavailable(question: NsQuestion): boolean {
  if (question.whenUnavailable === "default") {
    return question.default;
  }
  throw cancelado(
    `Cancelado: não há como responder "${question.message}".`,
    "Rode em um terminal interativo ou informe a decisão por flag.",
  );
}

/** Descarta eventos e aplica `whenUnavailable`. É o comportamento correto de `--no-input`. */
export function createSilentContext(): NsContext {
  return {
    emit() {},
    async ask(question: NsQuestion): Promise<boolean> {
      return applyWhenUnavailable(question);
    },
  };
}
