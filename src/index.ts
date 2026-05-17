import { Command } from "commander";
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

const program = new Command()
  .name("ns")
  .description("NeuroSteps Workspace CLI")
  .version("1.1.0");

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

// ─── Validate configuration (except for init command) ───
const args = process.argv.slice(2);
const firstArg = args[0];
const isBootstrapSafe =
  firstArg === "init" ||
  firstArg === "config" ||
  firstArg === "completion" ||
  firstArg === "help" ||
  firstArg === "--help" ||
  firstArg === "-h" ||
  firstArg === "--version" ||
  firstArg === "-V";

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

if (args.length <= 0) {
  program.help();
}

program.parse();
