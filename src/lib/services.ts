import { SERVICE_IDS, resolveServiceSession } from "./config";
import { exec, formatCommand, formatShellCommand, quoteShellArg } from "./shell";

/** O que o helper precisa de um Serviço do plano para subir a sessão. */
export interface ServiceSession {
  session: string;
  cwd: string;
  env: Record<string, string>;
  command: string;
  logFile: string;
}

export type ServiceStart = "started" | "running";

/**
 * Situação do painel da sessão tmux de um Serviço: o processo ainda vive, terminou com erro,
 * ou terminou porque alguém o encerrou (saída 0, ou Ctrl-C no Console).
 */
export type ServicePane = "alive" | "failed" | "exited";

const STOPPED_BY_USER = new Set(["0", "130"]);

// `=nome:` casa a sessão exata (sem o casamento por prefixo do tmux) e aponta
// para a janela dela, que é onde `remain-on-exit` e `pipe-pane` valem.
const target = (session: string) => `=${session}:`;

export async function hasTmux(run: typeof exec = exec): Promise<boolean> {
  try {
    return (await run(["tmux", "-V"], { silent: true })).exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Sobe o Serviço numa sessão tmux destacada, com a saída gravada em `logFile`.
 * Se a sessão já existe com o processo vivo, não mexe: o Serviço já está rodando.
 * Se o processo morreu (o painel ficou aberto pelo `remain-on-exit`), sobe de novo.
 */
export async function startService(service: ServiceSession, run: typeof exec = exec): Promise<ServiceStart> {
  const status = await run(["tmux", "display-message", "-p", "-t", target(service.session), "#{pane_dead}"], { silent: true });
  if (status.exitCode === 0 && status.stdout.trim() === "0") return "running";
  if (status.exitCode === 0) await stopService(service.session, run);

  await Bun.write(service.logFile, "");

  // Os três comandos vão numa chamada só: o tmux roda a fila inteira antes de olhar
  // o processo, então um Serviço que morre na partida ainda fica com o painel e o log.
  const shell = process.env.SHELL || "/bin/sh";
  const result = await run([
    "tmux", "new-session", "-d", "-s", service.session, "-c", service.cwd,
    // Login e interativo, como a janela do Terminal.app: o PATH do nvm/sdkman vem do .zshrc.
    shell, "-l", "-i", "-c", formatShellCommand(service.cwd, service.env, service.command),
    ";", "set-option", "-w", "-t", target(service.session), "remain-on-exit", "on",
    ";", "pipe-pane", "-o", "-t", target(service.session), `cat >> ${quoteShellArg(service.logFile)}`,
  ], { silent: true });
  if (result.exitCode !== 0) {
    throw new Error(`Falha ao criar a sessão tmux ${service.session}: ${(result.stderr || result.stdout).trim()}`);
  }
  return "started";
}

/**
 * Painel de cada sessão tmux aberta, numa chamada só. Sem tmux, ou sem servidor
 * tmux rodando, não há sessão nenhuma.
 */
export async function listServicePanes(run: typeof exec = exec): Promise<Map<string, ServicePane>> {
  const panes = new Map<string, ServicePane>();
  let result;
  try {
    // `:` separa os campos porque o tmux não aceita `:` em nome de sessão. Tab não serve:
    // sem locale UTF-8 (app aberto pelo Finder) o tmux troca o tab por `_`.
    result = await run(
      ["tmux", "list-panes", "-a", "-F", "#{session_name}:#{pane_dead}:#{pane_dead_status}"],
      { silent: true },
    );
  } catch {
    return panes;
  }
  if (result.exitCode !== 0) return panes;
  for (const line of result.stdout.split("\n")) {
    const [session, dead, status = ""] = line.split(":");
    if (!session) continue;
    panes.set(session, dead !== "1" ? "alive" : STOPPED_BY_USER.has(status) ? "exited" : "failed");
  }
  return panes;
}

// Palavra inteira, para não pegar "0 errors" nem "failed=0"; `Exception` também no fim de `BindException`.
const ERROR_LINE = /\b(error|fatal|erro)\b|exception\b|\bfailed\b(?!\s*[=:]\s*0)/i;
// Cores e movimentos de cursor do terminal, que o `pipe-pane` grava junto com o texto.
const ANSI = /\x1b\[[0-9;?]*[ -\/]*[@-~]|\x1b\][^\x07]*\x07/g;

/**
 * A linha que resume por que o Serviço falhou: a última do log que fala em erro, ou a
 * última linha, se nenhuma fala. Só olha o fim do log, onde a falha fica.
 */
export async function lastErrorLine(logFile: string): Promise<string | null> {
  const file = Bun.file(logFile);
  if (!(await file.exists())) return null;
  const tail = await file.slice(Math.max(0, file.size - 16_384)).text();
  const lines = tail.replace(ANSI, "").split(/\r?\n|\r/).map((line) => line.trim()).filter(Boolean);
  const line = lines.findLast((candidate) => ERROR_LINE.test(candidate)) ?? lines.at(-1);
  return line ? line.slice(0, 240) : null;
}

/** Derruba a sessão do Serviço. Sessão que não existe, ou tmux ausente, não é erro. */
export async function stopService(session: string, run: typeof exec = exec): Promise<void> {
  try {
    await run(["tmux", "kill-session", "-t", `=${session}`], { silent: true });
  } catch {
    // sem tmux não há sessão para derrubar
  }
}

/** Derruba as sessões de todos os Serviços da branch, existam ou não. */
export async function stopBranchSessions(slug: string, run: typeof exec = exec): Promise<void> {
  for (const id of SERVICE_IDS) {
    await stopService(resolveServiceSession(slug, id), run);
  }
}

/** Comando que abre uma vista da sessão: fechar a janela desanexa, não para o Serviço. */
export function attachCommand(session: string): string {
  return formatCommand(["tmux", "attach-session", "-t", session]);
}
