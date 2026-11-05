import { z } from "zod";
import {
  OPTIONAL_REPOS,
  type NsContext,
  type PrepareInput,
  type PrepareResult,
  type ServiceId,
  ferramentaExterna,
  preCondicao,
  runAddRepo as defaultRunAddRepo,
  runDbOpen as defaultRunDbOpen,
  runDbRestore as defaultRunDbRestore,
  runDbRmSnapshot as defaultRunDbRmSnapshot,
  runDbSnapshot as defaultRunDbSnapshot,
  runDbSnapshots as defaultRunDbSnapshots,
  runNew as defaultRunNew,
  runPrepare as defaultRunPrepare,
  runPull as defaultRunPull,
  runRm as defaultRunRm,
  runRmPreview as defaultRunRmPreview,
  runStatus as defaultRunStatus,
  runStop as defaultRunStop,
  servicesToStart,
} from "../core";
import { SERVICE_IDS } from "../lib/config";
import { listListeningPorts } from "../lib/ports";
import { hasTmux, startService } from "../lib/services";
import { exec } from "../lib/shell";
import { describeIssues } from "./protocol";

/** Uma operação servida pelo `ns rpc`. Recebe o `input` cru da mensagem e valida por conta própria. */
export type RpcOperation = (input: unknown, ctx: NsContext) => Promise<unknown>;

export type RpcOperations = Record<string, RpcOperation>;

/** Input que não passa no schema da operação. O servidor o devolve como erro de protocolo. */
export class RpcInputError extends Error {}

/** Valida o `input` com o schema antes de chamar a operação. */
export function withInput<I>(
  schema: z.ZodType<I>,
  run: (input: I, ctx: NsContext) => Promise<unknown>,
): RpcOperation {
  return async (raw, ctx) => {
    const parsed = schema.safeParse(raw ?? {});
    if (!parsed.success) {
      throw new RpcInputError(`Input inválido: ${describeIssues(parsed.error)}`);
    }
    return run(parsed.data, ctx);
  };
}

export interface RpcOperationDeps {
  runStatus: typeof defaultRunStatus;
  runPrepare: typeof defaultRunPrepare;
  runStop: typeof defaultRunStop;
  runNew: typeof defaultRunNew;
  runAddRepo: typeof defaultRunAddRepo;
  runPull: typeof defaultRunPull;
  runRmPreview: typeof defaultRunRmPreview;
  runRm: typeof defaultRunRm;
  runDbOpen: typeof defaultRunDbOpen;
  runDbSnapshots: typeof defaultRunDbSnapshots;
  runDbSnapshot: typeof defaultRunDbSnapshot;
  runDbRestore: typeof defaultRunDbRestore;
  runDbRmSnapshot: typeof defaultRunDbRmSnapshot;
  runTmux: typeof exec;
  listListeningPorts: () => Promise<Set<number>>;
}

/** Operações do núcleo servidas pelo `ns rpc`. Cada operação migrada para o núcleo entra aqui. */
export function createRpcOperations(deps: Partial<RpcOperationDeps> = {}): RpcOperations {
  const runStatus = deps.runStatus ?? defaultRunStatus;
  const runPrepare = deps.runPrepare ?? defaultRunPrepare;
  const runStop = deps.runStop ?? defaultRunStop;
  const runNew = deps.runNew ?? defaultRunNew;
  const runAddRepo = deps.runAddRepo ?? defaultRunAddRepo;
  const runPull = deps.runPull ?? defaultRunPull;
  const runRmPreview = deps.runRmPreview ?? defaultRunRmPreview;
  const runRm = deps.runRm ?? defaultRunRm;
  const runDbOpen = deps.runDbOpen ?? defaultRunDbOpen;
  const runDbSnapshots = deps.runDbSnapshots ?? defaultRunDbSnapshots;
  const runDbSnapshot = deps.runDbSnapshot ?? defaultRunDbSnapshot;
  const runDbRestore = deps.runDbRestore ?? defaultRunDbRestore;
  const runDbRmSnapshot = deps.runDbRmSnapshot ?? defaultRunDbRmSnapshot;
  const runTmux = deps.runTmux ?? exec;
  const listening = deps.listListeningPorts ?? (() => listListeningPorts());
  const installMissingDeps = z.enum(["always", "ask", "never"]).default("ask");
  const prepareInput = z.strictObject({
    branch: z.string().min(1),
    withManager: z.boolean().optional(),
    withReportServer: z.boolean().optional(),
    installMissingDeps,
  });
  const service = z.enum(SERVICE_IDS).optional();

  return {
    status: withInput(
      z.strictObject({ branch: z.string().min(1).optional() }),
      (input, ctx) => runStatus(input, ctx),
    ),
    prepare: withInput(prepareInput, (input, ctx) => runPrepare(input, ctx)),
    start: withInput(
      prepareInput.extend({ service }),
      ({ service, ...input }, ctx) => startBranch(input, service, ctx, { runPrepare, runTmux, listening }),
    ),
    stop: withInput(
      z.strictObject({ branch: z.string().min(1), service }),
      (input, ctx) => runStop(input, ctx),
    ),
    new: withInput(
      z.strictObject({
        branch: z.string().min(1),
        baseBranch: z.string().min(1).optional(),
        repos: z.array(z.enum(OPTIONAL_REPOS)).default(["manager"]),
        installMissingDeps,
      }),
      (input, ctx) => runNew(input, ctx),
    ),
    addRepo: withInput(
      z.strictObject({ branch: z.string().min(1), repo: z.enum(OPTIONAL_REPOS), base: z.string().min(1).optional() }),
      (input, ctx) => runAddRepo(input, ctx),
    ),
    pull: withInput(
      z.strictObject({ branch: z.string().min(1) }),
      (input, ctx) => runPull(input, ctx),
    ),
    rmPreview: withInput(
      z.strictObject({ branch: z.string().min(1) }),
      (input, ctx) => runRmPreview(input, ctx),
    ),
    // Sem `force`: pelo adapter, alterações não commitadas sempre bloqueiam a remoção.
    rm: withInput(
      z.strictObject({ branch: z.string().min(1), purge: z.boolean().default(false) }),
      (input, ctx) => runRm(input, ctx),
    ),
    // Sem `app`: pelo adapter abre sempre o app configurado no ns.
    dbOpen: withInput(
      z.strictObject({ branch: z.string().min(1) }),
      (input, ctx) => runDbOpen(input, ctx),
    ),
    dbSnapshots: withInput(
      z.strictObject({ branch: z.string().min(1).optional() }),
      (input, ctx) => runDbSnapshots(input, ctx),
    ),
    // `name` obrigatório: pelo adapter, o nome é sempre pedido ao desenvolvedor.
    // Nome repetido é `conflito`; o adapter confirma com o desenvolvedor antes de pedir `replace`.
    dbSnapshot: withInput(
      z.strictObject({ branch: z.string().min(1), name: z.string().min(1), replace: z.boolean().default(false) }),
      (input, ctx) => runDbSnapshot(input, ctx),
    ),
    dbRestore: withInput(
      z.strictObject({ branch: z.string().min(1), ref: z.string().min(1) }),
      (input, ctx) => runDbRestore(input, ctx),
    ),
    dbRmSnapshot: withInput(
      z.strictObject({ branch: z.string().min(1), name: z.string().min(1) }),
      (input, ctx) => runDbRmSnapshot(input, ctx),
    ),
  };
}

/**
 * Iniciar: Preparar e subir o Plano de serviços em sessões tmux, como o `ns start`, mas sem
 * abrir janelas. Sem tmux não há como o Serviço sobreviver ao cliente, então nem prepara.
 * Serviço que já atende na porta (subiu pelo terminal, pela IDE) fica como está.
 * Com `service`, sobe só aquele Serviço; a branch é preparada do mesmo jeito, porque o
 * Serviço precisa do banco e dos aliases.
 */
async function startBranch(
  input: PrepareInput,
  service: ServiceId | undefined,
  ctx: NsContext,
  deps: Pick<RpcOperationDeps, "runPrepare" | "runTmux"> & { listening: () => Promise<Set<number>> },
): Promise<PrepareResult> {
  const { runPrepare, runTmux } = deps;
  if (!(await hasTmux(runTmux))) {
    throw preCondicao("tmux não encontrado: os Serviços precisam dele para continuar rodando.", "Instale com: brew install tmux");
  }
  const result = await runPrepare(input, ctx);
  const planned = servicesToStart(result, service);
  const listening = await deps.listening();
  for (const plan of planned.filter(({ port }) => !listening.has(port))) {
    ctx.emit({ step: `start:${plan.id}`, label: `Iniciando ${plan.label}...` });
    await startService(plan, runTmux).catch((error) => {
      throw ferramentaExterna(error instanceof Error ? error.message : String(error), { cause: error });
    });
  }
  return result;
}
