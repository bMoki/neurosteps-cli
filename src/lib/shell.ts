export interface ShellOptions {
  cwd?: string;
  env?: Record<string, string>;
  silent?: boolean;
}

export interface ShellResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  command: string[];
}

export function formatCommand(command: string[]): string {
  return command.map((arg) => {
    if (/^[A-Za-z0-9_./:=@%+-]+$/.test(arg)) {
      return arg;
    }
    return `'${arg.replace(/'/g, `'\\''`)}'`;
  }).join(" ");
}

export function commandErrorMessage(action: string, result: ShellResult): string {
  const output = (result.stderr || result.stdout).trim();
  const message = `Falha ao ${action} (exit ${result.exitCode}): ${formatCommand(result.command)}`;
  return output ? `${message}\n${output}` : message;
}

export function assertSuccess(result: ShellResult, action: string): void {
  if (result.exitCode !== 0) {
    throw new Error(commandErrorMessage(action, result));
  }
}

export async function exec(
  command: string[],
  opts: ShellOptions = {},
): Promise<ShellResult> {
  const [cmd, ...args] = command;
  const proc = Bun.spawn([cmd!, ...args], {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    stdout: opts.silent ? "pipe" : "inherit",
    stderr: opts.silent ? "pipe" : "inherit",
  });

  const exitCode = await proc.exited;
  const stdout = opts.silent ? await new Response(proc.stdout).text() : "";
  const stderr = opts.silent ? await new Response(proc.stderr).text() : "";

  return { exitCode, stdout, stderr, command };
}

export async function execChecked(
  command: string[],
  opts: ShellOptions = {},
  action = "executar comando externo",
): Promise<ShellResult> {
  let result: ShellResult;
  try {
    result = await exec(command, opts);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Falha ao ${action}: ${formatCommand(command)}\n${reason}`);
  }
  assertSuccess(result, action);
  return result;
}

export function execSync(
  command: string[],
  opts: ShellOptions = {},
): ShellResult {
  const [cmd, ...args] = command;
  const proc = Bun.spawnSync([cmd!, ...args], {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    stdout: opts.silent ? "pipe" : "inherit",
    stderr: opts.silent ? "pipe" : "inherit",
  });

  const stdout = opts.silent ? new TextDecoder().decode(proc.stdout) : "";
  const stderr = opts.silent ? new TextDecoder().decode(proc.stderr) : "";

  return { exitCode: proc.exitCode, stdout, stderr, command };
}

export function execSyncChecked(
  command: string[],
  opts: ShellOptions = {},
  action = "executar comando externo",
): ShellResult {
  let result: ShellResult;
  try {
    result = execSync(command, opts);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Falha ao ${action}: ${formatCommand(command)}\n${reason}`);
  }
  assertSuccess(result, action);
  return result;
}

export async function spawnTerminal(
  cwd: string,
  env: Record<string, string>,
  command: string,
): Promise<void> {
  const envStr = Object.entries(env)
    .map(([k, v]) => `export ${k}="${v}"`)
    .join(" && ");
  
  const script = `tell application "Terminal"
    do script "cd '${cwd}' && ${envStr} && ${command}"
  end tell`;

  await execChecked(["osascript", "-e", script], { silent: true }, "abrir Terminal.app no macOS");
}

export async function openApp(app: string, path?: string): Promise<void> {
  const args = ["-a", app];
  if (path) args.push(path);
  await execChecked(["open", ...args], { silent: true }, `abrir app macOS ${app}`);
}
