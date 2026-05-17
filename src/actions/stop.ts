import { spinner } from "../lib/logger";
import {
  type BranchShutdownDeps,
  BranchShutdownNotFoundError,
  shutdownBranchRuntime,
} from "./branch-shutdown";

export async function stopAction(
  branch: string,
  deps: Partial<BranchShutdownDeps> = {},
): Promise<void> {
  const s = spinner(`Parando ${branch}...`).start();

  try {
    await shutdownBranchRuntime(branch, {
      onStep: (step) => {
        if (step === "database:stop") s.text = "Parando PostgreSQL...";
        if (step === "portless:aliases") s.text = "Removendo aliases Portless...";
        if (step === "processes:stop") s.text = "Encerrando processos...";
      },
    }, deps);
  } catch (error) {
    if (error instanceof BranchShutdownNotFoundError) {
      s.fail(error.message);
      process.exit(1);
    }
    throw error;
  }

  s.succeed(`Serviços parados para ${branch}`);
}
