import chalk from "chalk";
import ora, { type Ora } from "ora";
import { shouldUseColor, isQuietEnabled } from "./cli";

type ColorFn = (msg: string) => string;

function color(fn: ColorFn): ColorFn {
  return (msg) => shouldUseColor() ? fn(msg) : msg;
}

export const colors = {
  info: color(chalk.blue),
  ok: color(chalk.green),
  warn: color(chalk.yellow),
  err: color(chalk.red),
  muted: color(chalk.gray),
  value: color(chalk.cyan),
  bold: color(chalk.bold),
};

export function info(msg: string): void {
  if (isQuietEnabled()) return;
  console.error(`${colors.info("i")} ${msg}`);
}

export function ok(msg: string): void {
  console.log(`${colors.ok("✓")} ${colors.ok(msg)}`);
}

export function warn(msg: string): void {
  console.error(`${colors.warn("⚠")} ${colors.warn(msg)}`);
}

export function error(msg: string): void {
  console.error(`${colors.err("✗")} ${colors.err(msg)}`);
}

export function spinner(text: string): Ora {
  return ora({
    text: colors.info(text),
    color: "blue",
    stream: process.stderr,
    isEnabled: Boolean(process.stderr.isTTY),
  });
}

export function heading(title: string): void {
  if (isQuietEnabled()) return;
  const line = "═".repeat(55);
  const paint = shouldUseColor() ? chalk.blue : (s: string) => s;
  console.log(paint(line));
  console.log(paint(`  ${title}`));
  console.log(paint(line));
}

export function section(title: string): void {
  if (isQuietEnabled()) return;
  console.log("");
  console.log(colors.bold(colors.info(title)));
}

export function detail(label: string, value: string | number): void {
  if (isQuietEnabled()) return;
  console.log(`  ${colors.muted(`${label}:`)} ${colors.value(String(value))}`);
}

export function hint(message: string): void {
  if (isQuietEnabled()) return;
  console.error(colors.muted(message));
}

export function emptyLine(): void {
  if (isQuietEnabled()) return;
  console.log("");
}
