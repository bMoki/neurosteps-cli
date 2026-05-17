import { Command, CommanderError } from "commander";
import {
  statusCommand,
  prepareCommand,
  stopCommand,
  initCommand,
  portlessCommand,
  startCommand,
  openCommand,
  closeCommand,
  newCommand,
  rmCommand,
  dbCommand,
  doctorCommand,
  workspaceCommand,
  configCommand,
  completionCommand,
  addCommand,
} from "./commands";
import { isConfigured, getMissingVars } from "./lib/env";
import { addGlobalCliOptions, configureCliProgram, isDebugEnabled, isGlobalBooleanFlag } from "./lib/cli";
import { error } from "./lib/logger";

const program = configureCliProgram(new Command()
  .name("ns")
  .description("NeuroSteps Workspace CLI")
  .version("1.1.0"));

program
  .addCommand(initCommand())
  .addCommand(prepareCommand())
  .addCommand(startCommand())
  .addCommand(stopCommand())
  .addCommand(statusCommand())
  .addCommand(portlessCommand())
  .addCommand(addCommand())
  .addCommand(newCommand())
  .addCommand(rmCommand())
  .addCommand(openCommand())
  .addCommand(closeCommand())
  .addCommand(doctorCommand())
  .addCommand(dbCommand())
  .addCommand(workspaceCommand())
  .addCommand(configCommand())
  .addCommand(completionCommand());

addGlobalCliOptions(program);

async function main(argv = process.argv): Promise<void> {
  // ─── Validate configuration (except for bootstrap-safe commands) ───
  const args = argv.slice(2);
  const commandArgs = args.filter((arg) => !isGlobalBooleanFlag(arg));
  const firstArg = commandArgs[0];
  const wantsHelp = commandArgs.includes("--help") || commandArgs.includes("-h") || firstArg === "help";
  const wantsVersion = commandArgs.includes("--version") || commandArgs.includes("-V");
  const isBootstrapSafe =
    commandArgs.length === 0 ||
    wantsHelp ||
    wantsVersion ||
    firstArg === "init" ||
    firstArg === "config" ||
    firstArg === "completion";

  if (!isBootstrapSafe && !isConfigured()) {
    console.error("⚠️  CLI não configurado.");
    console.error("");
    const missing = getMissingVars();
    if (missing.length > 0) {
      console.error("Variáveis faltando:");
      for (const v of missing) {
        console.error(`  - ${v}`);
      }
      console.error("");
    }
    console.error("Rode 'ns init' para configurar.");
    process.exit(1);
  }

  if (commandArgs.length <= 0) {
    program.outputHelp();
    return;
  }

  await program.parseAsync(argv);
}

function isCommanderError(error: unknown): error is CommanderError {
  return error instanceof CommanderError
    || (typeof error === "object"
      && error !== null
      && "code" in error
      && String((error as { code?: unknown }).code).startsWith("commander."));
}

main().catch((err) => {
  if (isCommanderError(err)) {
    process.exitCode = err.exitCode;
    return;
  }

  error(err instanceof Error ? err.message : String(err));
  if (isDebugEnabled()) {
    console.error("");
    console.error(err instanceof Error && err.stack ? err.stack : err);
  } else {
    console.error("Rode novamente com --debug para detalhes técnicos.");
  }
  process.exitCode = 1;
});
