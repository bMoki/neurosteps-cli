import { z } from "zod";
import { type NsContext, runStatus as defaultRunStatus } from "../core";
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
}

/** Operações do núcleo servidas pelo `ns rpc`. Cada operação migrada para o núcleo entra aqui. */
export function createRpcOperations(deps: Partial<RpcOperationDeps> = {}): RpcOperations {
  const runStatus = deps.runStatus ?? defaultRunStatus;

  return {
    status: withInput(
      z.strictObject({ branch: z.string().min(1).optional() }),
      (input, ctx) => runStatus(input, ctx),
    ),
  };
}
