export type NsErrorCategory =
  | "nao-encontrado"      // branch, snapshot, worktree inexistente
  | "conflito"            // já existe, porta ocupada
  | "pre-condicao"        // docker parado, CLI não configurado, repo ausente
  | "ferramenta-externa"  // git/docker/mvn/npm retornou erro
  | "cancelado";          // usuário respondeu não

export interface NsErrorOptions {
  hint?: string;   // sugestão acionável para o usuário
  cause?: unknown; // erro original, para --debug
}

export class NsError extends Error {
  readonly category: NsErrorCategory;
  readonly hint?: string;

  constructor(category: NsErrorCategory, message: string, options: NsErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = "NsError";
    this.category = category;
    this.hint = options.hint;
  }
}

export function isNsError(value: unknown): value is NsError {
  return value instanceof NsError;
}

/** Atalho: uma string é lida como `hint`, o caso mais comum nos call sites. */
export type NsErrorDetails = string | NsErrorOptions;

export function naoEncontrado(message: string, details?: NsErrorDetails): NsError {
  return new NsError("nao-encontrado", message, toOptions(details));
}

export function conflito(message: string, details?: NsErrorDetails): NsError {
  return new NsError("conflito", message, toOptions(details));
}

export function preCondicao(message: string, details?: NsErrorDetails): NsError {
  return new NsError("pre-condicao", message, toOptions(details));
}

export function ferramentaExterna(message: string, details?: NsErrorDetails): NsError {
  return new NsError("ferramenta-externa", message, toOptions(details));
}

export function cancelado(message: string, details?: NsErrorDetails): NsError {
  return new NsError("cancelado", message, toOptions(details));
}

function toOptions(details: NsErrorDetails = {}): NsErrorOptions {
  return typeof details === "string" ? { hint: details } : details;
}
