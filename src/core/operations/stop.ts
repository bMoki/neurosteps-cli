import {
  type BranchShutdownDeps,
  type BranchShutdownStep,
  BranchShutdownNotFoundError,
  shutdownBranchRuntime,
} from "../../actions/branch-shutdown";
import type { NsContext } from "../context";
import { ferramentaExterna, naoEncontrado } from "../errors";

export interface StopInput {
  branch: string;
}

export interface StopResult {
  branch: string;
}

const STOP_LABELS: Record<BranchShutdownStep, string> = {
  "database:stop": "Parando PostgreSQL...",
  "portless:aliases": "Removendo aliases Portless...",
  "processes:stop": "Encerrando os Serviços...",
};

/** Parar a branch: derruba o banco, os aliases e todos os Serviços, estejam no tmux ou não. */
export async function runStop(
  input: StopInput,
  ctx: NsContext,
  deps: Partial<BranchShutdownDeps> = {},
): Promise<StopResult> {
  await shutdownBranchRuntime(input.branch, {
    onStep: (step) => ctx.emit({ step, label: STOP_LABELS[step] }),
  }, deps).catch((error) => {
    if (error instanceof BranchShutdownNotFoundError) {
      throw naoEncontrado(error.message, "Rode 'ns status' para ver as branches disponíveis.");
    }
    throw ferramentaExterna(error instanceof Error ? error.message : String(error), { cause: error });
  });
  return { branch: input.branch };
}
