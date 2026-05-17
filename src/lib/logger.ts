import chalk from "chalk";
import ora, { type Ora } from "ora";

export const colors = {
  info: chalk.blue,
  ok: chalk.green,
  warn: chalk.yellow,
  err: chalk.red,
  muted: chalk.gray,
  value: chalk.cyan,
  bold: chalk.bold,
};

export function info(msg: string): void {
  console.log(`${colors.info("i")} ${msg}`);
}

export function ok(msg: string): void {
  console.log(`${colors.ok("✓")} ${colors.ok(msg)}`);
}

export function warn(msg: string): void {
  console.log(`${colors.warn("⚠")} ${colors.warn(msg)}`);
}

export function error(msg: string): void {
  console.error(`${colors.err("✗")} ${colors.err(msg)}`);
}

export function spinner(text: string): Ora {
  return ora({ text: colors.info(text), color: "blue" });
}

export function heading(title: string): void {
  const line = "═".repeat(55);
  console.log(chalk.blue(line));
  console.log(chalk.blue(`  ${title}`));
  console.log(chalk.blue(line));
}

export function section(title: string): void {
  console.log("");
  console.log(colors.bold(colors.info(title)));
}

export function detail(label: string, value: string | number): void {
  console.log(`  ${colors.muted(`${label}:`)} ${colors.value(String(value))}`);
}

export function hint(message: string): void {
  console.log(colors.muted(message));
}

export function emptyLine(): void {
  console.log("");
}
