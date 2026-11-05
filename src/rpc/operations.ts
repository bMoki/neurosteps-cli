import { z } from "zod";
import {
  type NsContext,
  type PrepareInput,
  type PrepareResult,
  ferramentaExterna,
  preCondicao,
  runPrepare as defaultRunPrepare,
  runStatus as defaultRunStatus,
  runStop as defaultRunStop,
} from "../core";
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
  runTmux: typeof exec;
  listListeningPorts: () => Promise<Set<number>>;
}

/** Operações do núcleo servidas pelo `ns rpc`. Cada operação migrada para o núcleo entra aqui. */
export function createRpcOperations(deps: Partial<RpcOperationDeps> = {}): RpcOperations {
  const runStatus = deps.runStatus ?? defaultRunStatus;
  const runPrepare = deps.runPrepare ?? defaultRunPrepare;
  const runStop = deps.runStop ?? defaultRunStop;
  const runTmux = deps.runTmux ?? exec;
  const listening = deps.listListeningPorts ?? (() => listListeningPorts());
  const prepareInput = z.strictObject({
    branch: z.string().min(1),
    withManager: z.boolean().optional(),
    withReportServer: z.boolean().optional(),
    installMissingDeps: z.enum(["always", "ask", "never"]).default("ask"),
  });

  return {
    status: withInput(
      z.strictObject({ branch: z.string().min(1).optional() }),
      (input, ctx) => runStatus(input, ctx),
    ),
    prepare: withInput(prepareInput, (input, ctx) => runPrepare(input, ctx)),
    start: withInput(prepareInput, (input, ctx) => startBranch(input, ctx, { runPrepare, runTmux, listening })),
    stop: withInput(
      z.strictObject({ branch: z.string().min(1) }),
      (input, ctx) => runStop(input, ctx),
    ),
  };
}

/**
 * Iniciar: Preparar e subir o Plano de serviços em sessões tmux, como o `ns start`, mas sem
 * abrir janelas. Sem tmux não há como o Serviço sobreviver ao cliente, então nem prepara.
 * Serviço que já atende na porta (subiu pelo terminal, pela IDE) fica como está.
 */
async function startBranch(
  input: PrepareInput,
  ctx: NsContext,
  deps: Pick<RpcOperationDeps, "runPrepare" | "runTmux"> & { listening: () => Promise<Set<number>> },
): Promise<PrepareResult> {
  const { runPrepare, runTmux } = deps;
  if (!(await hasTmux(runTmux))) {
    throw preCondicao("tmux não encontrado: os Serviços precisam dele para continuar rodando.", "Instale com: brew install tmux");
  }
  const result = await runPrepare(input, ctx);
  const listening = await deps.listening();
  for (const service of result.services.filter(({ port }) => !listening.has(port))) {
    ctx.emit({ step: `start:${service.id}`, label: `Iniciando ${service.label}...` });
    await startService(service, runTmux).catch((error) => {
      throw ferramentaExterna(error instanceof Error ? error.message : String(error), { cause: error });
    });
  }
  return result;
}
