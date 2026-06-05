import { spinner } from "../lib/logger";
import { listBranches } from "../lib/config";
import {
  type BranchShutdownDeps,
  BranchShutdownNotFoundError,
  shutdownBranchRuntime,
} from "./branch-shutdown";

export async function stopAction(
  branch: string | undefined,
  opts: { all?: boolean },
  deps: Partial<BranchShutdownDeps> = {},
): Promise<void> {
  if (opts.all) {
    await stopAllAction(deps);
    return;
  }
  if (!branch) {
    spinner("").fail("Especifique uma branch ou use --all (-a)");
    process.exit(1);
  }
  await stopSingleAction(branch, deps);
}

async function stopSingleAction(branch: string, deps: Partial<BranchShutdownDeps> = {}): Promise<void> {
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

async function stopAllAction(deps: Partial<BranchShutdownDeps> = {}): Promise<void> {
  const branches = listBranches();

  if (branches.length === 0) {
    spinner("").info("Nenhuma branch encontrada.");
    return;
  }

  const failures: { branch: string; message: string }[] = [];

  for (const [i, branch] of branches.entries()) {
    const prefix = `[${i + 1}/${branches.length}]`;
    const s = spinner(`${prefix} Parando ${branch}...`).start();

    try {
      await shutdownBranchRuntime(branch, {
        onStep: (step) => {
          if (step === "database:stop") s.text = `${prefix} Parando PostgreSQL de ${branch}...`;
          if (step === "portless:aliases") s.text = `${prefix} Removendo aliases de ${branch}...`;
          if (step === "processes:stop") s.text = `${prefix} Encerrando processos de ${branch}...`;
        },
      }, deps);
      s.succeed(`Serviços parados para ${branch}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      s.fail(`${branch}: ${message}`);
      failures.push({ branch, message });
    }
  }

  const stopped = branches.length - failures.length;
  if (failures.length > 0) {
    console.error(`\n${stopped} parada(s), ${failures.length} com erro.`);
    process.exit(1);
  } else {
    console.log(`\n${stopped} branch(es) parada(s).`);
  }
}
