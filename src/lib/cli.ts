import { Command } from "commander";

const GLOBAL_BOOLEAN_FLAGS = new Set(["--debug", "-d", "--no-color", "--no-input", "--quiet", "-q"]);

export function isGlobalBooleanFlag(arg: string): boolean {
  return GLOBAL_BOOLEAN_FLAGS.has(arg);
}

export function addGlobalCliOptions(command: Command): Command {
  command
    .option("-d, --debug", "mostra detalhes de erros inesperados")
    .option("--no-color", "desativa cores na saída")
    .option("--no-input", "desativa prompts interativos")
    .option("-q, --quiet", "suprime mensagens informativas (mantém ok/warn/error)");

  for (const child of command.commands) {
    addGlobalCliOptions(child);
  }

  return command;
}

export function configureCliProgram(program: Command): Command {
  return program
    .configureOutput({
      writeOut: (str) => process.stdout.write(str),
      writeErr: (str) => process.stderr.write(str),
      outputError: (str, write) => write(colorError(str)),
    })
    .showHelpAfterError("(use --help para mais informações)")
    .showSuggestionAfterError()
    .exitOverride();
}

export function isDebugEnabled(): boolean {
  return Boolean(
    process.argv.includes("--debug")
      || process.env.NS_DEBUG
      || process.env.DEBUG,
  );
}

export function isNoInputEnabled(): boolean {
  return Boolean(
    process.argv.includes("--no-input")
      || process.env.NS_NO_INPUT,
  );
}

export function isQuietEnabled(): boolean {
  return Boolean(
    process.argv.includes("--quiet")
      || process.argv.includes("-q")
      || process.env.NS_QUIET,
  );
}

export function shouldUseColor(): boolean {
  if (process.argv.includes("--no-color")) return false;
  if (process.env.NO_COLOR) return false;
  if (process.env.TERM === "dumb") return false;
  return Boolean(process.stdout.isTTY || process.stderr.isTTY);
}

function colorError(str: string): string {
  return shouldUseColor() ? `\x1b[31m${str}\x1b[0m` : str;
}
