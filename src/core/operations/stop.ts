import {
  type BranchShutdownDeps,
  type BranchShutdownStep,
  BranchShutdownNotFoundError,
  shutdownBranchRuntime,
  shutdownService,
} from "../../actions/branch-shutdown";
import type { NsContext } from "../context";
import { ferramentaExterna, naoEncontrado } from "../errors";
import type { ServiceId } from "./prepare";

export interface StopInput {
  branch: string;
  service?: ServiceId;   // ausente = a branch inteira
}

export interface StopResult {
  branch: string;
}

const STOP_LABELS: Record<BranchShutdownStep, string> = {
  "database:stop": "Parando PostgreSQL...",
  "portless:aliases": "Removendo aliases Portless...",
  "processes:stop": "Encerrando os Serviços...",
};

/**
 * Parar a branch: derruba o banco, os aliases e todos os Serviços, estejam no tmux ou não.
 * Com `service`, para só aquele Serviço e deixa o resto da branch como está.
 */
export async function runStop(
  input: StopInput,
  ctx: NsContext,
  deps: Partial<BranchShutdownDeps> = {},
): Promise<StopResult> {
  const { branch, service } = input;
  await shutdown(branch, service, ctx, deps).catch((error) => {
    if (error instanceof BranchShutdownNotFoundError) {
      throw naoEncontrado(error.message, "Rode 'ns status' para ver as branches disponíveis.");
    }
    throw ferramentaExterna(error instanceof Error ? error.message : String(error), { cause: error });
  });
  return { branch };
}

async function shutdown(
  branch: string,
  service: ServiceId | undefined,
  ctx: NsContext,
  deps: Partial<BranchShutdownDeps>,
): Promise<void> {
  if (!service) {
    await shutdownBranchRuntime(branch, { onStep: (step) => ctx.emit({ step, label: STOP_LABELS[step] }) }, deps);
    return;
  }
  ctx.emit({ step: "processes:stop", label: `Parando ${service}...` });
  await shutdownService(branch, service, deps);
}
