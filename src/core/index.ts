// Superfície pública do núcleo do ns.
// Só entra aqui o que um plugin pode usar e que nos comprometemos a manter.
// Bibliotecas internas (docker, git, ports, templates) NÃO entram — são promovidas caso a caso.

export type { NsErrorCategory, NsErrorDetails, NsErrorOptions } from "./errors";
export {
  NsError,
  isNsError,
  naoEncontrado,
  conflito,
  preCondicao,
  ferramentaExterna,
  cancelado,
} from "./errors";

export type { NsContext, NsProgressEvent, NsQuestion } from "./context";
export { applyWhenUnavailable, createSilentContext } from "./context";

export type { BranchStatus, StatusInput, StatusResult } from "./operations/status";
export { runStatus } from "./operations/status";
