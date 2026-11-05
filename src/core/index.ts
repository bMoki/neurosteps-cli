// Superfície pública do núcleo do ns.
// Só entra aqui o que um plugin pode usar e que nos comprometemos a manter.
// Bibliotecas internas (docker, git, ports, templates) NÃO entram — são promovidas caso a caso.

export type { NsErrorCategory, NsErrorDetails, NsErrorOptions } from "./errors";
export {
  NsError,
  asNsError,
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

export type { AddableRepo, AddRepoDeps, AddRepoInput, AddRepoResult, OptionalRepo } from "./operations/add-repo";
export { ADDABLE_REPOS, OPTIONAL_REPOS, repoLabel, runAddRepo } from "./operations/add-repo";

export type { MissingRepo, NewDeps, NewInput, NewResult } from "./operations/new";
export { runNew } from "./operations/new";

export type { PullDeps, PullInput, PullRepoResult, PullResult, PullStatus } from "./operations/pull";
export { DEFAULT_BRANCH_ALIAS, runPull } from "./operations/pull";

export type { RmDeps, RmInput, RmPreview, RmResult, UncommittedRepo } from "./operations/rm";
export { runRm, runRmPreview, uncommittedError } from "./operations/rm";

export type { DbOpenDeps, DbOpenInput, DbOpenResult } from "./operations/db-open";
export { runDbOpen } from "./operations/db-open";

export type {
  DbRestoreInput,
  DbRestorePreview,
  DbSnapshotNameInput,
  DbSnapshotInput,
  DbSnapshotsInput,
  Snapshot,
  SnapshotDeps,
  SnapshotGroup,
} from "./operations/snapshot";
export { runDbRestore, runDbRestorePreview, runDbRmSnapshot, runDbSnapshot, runDbSnapshotFind, runDbSnapshots, snapshotFile } from "./operations/snapshot";
