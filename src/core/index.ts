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

export type {
  BaseRepo,
  BranchStatus,
  DbState,
  ServiceKey,
  ServiceState,
  StatusInput,
  StatusResult,
} from "./operations/status";
export { deriveServiceState, runStatus } from "./operations/status";

export type {
  MissingDep,
  PrepareDeps,
  PrepareInput,
  PrepareResult,
  ServiceId,
  ServicePlan,
} from "./operations/prepare";
export { runPrepare, servicesToStart } from "./operations/prepare";

export type { StopInput, StopResult } from "./operations/stop";
export { runStop } from "./operations/stop";
