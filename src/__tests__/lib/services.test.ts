import { describe, expect, mock, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { STATE_DIR } from "../../lib/config";
import { attachCommand, hasTmux, startService, stopService, type ServiceSession } from "../../lib/services";
import { createShellResult } from "../setup";

const service = (logFile: string): ServiceSession => ({
  session: "ns-feat-123-backend",
  cwd: "/wt/feat-123/backend",
  env: { QUARKUS_HTTP_PORT: "8084" },
  command: "mvn -pl scalemed-core quarkus:dev",
  logFile,
});

/** tmux falso: `pane` diz como está o painel da sessão (undefined = sessão não existe). */
const fakeTmux = (pane?: "0" | "1") =>
  mock((command: string[]) => {
    if (command[1] === "display-message") {
      return Promise.resolve(pane === undefined
        ? createShellResult(command, { exitCode: 1, stderr: "can't find session" })
        : createShellResult(command, { stdout: `${pane}\n` }));
    }
    return Promise.resolve(createShellResult(command));
  });

describe("startService", () => {
  test("cria a sessão destacada, mantém o painel ao sair e grava a saída no log", async () => {
    const logFile = join(STATE_DIR, "feat-123", "backend.log");
    const run = fakeTmux();

    expect(await startService(service(logFile), run)).toBe("started");

    const create = run.mock.calls.at(-1)![0];
    expect(create.slice(0, 7)).toEqual(["tmux", "new-session", "-d", "-s", "ns-feat-123-backend", "-c", "/wt/feat-123/backend"]);
    const [shell, login, interactive, dashC, shellCommand] = create.slice(7, 12);
    expect([shell, login, interactive, dashC]).toEqual([process.env.SHELL || "/bin/sh", "-l", "-i", "-c"]);
    expect(shellCommand).toBe("cd /wt/feat-123/backend && export QUARKUS_HTTP_PORT=8084 && mvn -pl scalemed-core quarkus:dev");
    expect(create.slice(12)).toEqual([
      ";", "set-option", "-w", "-t", "=ns-feat-123-backend:", "remain-on-exit", "on",
      ";", "pipe-pane", "-o", "-t", "=ns-feat-123-backend:", `cat >> ${logFile}`,
    ]);
    expect(existsSync(logFile)).toBe(true);
  });

  test("trunca o log da execução anterior", async () => {
    const logFile = join(STATE_DIR, "feat-trunc", "backend.log");
    mkdirSync(join(STATE_DIR, "feat-trunc"), { recursive: true });
    writeFileSync(logFile, "saída antiga\n");

    await startService(service(logFile), fakeTmux());

    expect(readFileSync(logFile, "utf8")).toBe("");
  });

  test("não mexe num Serviço que já está rodando", async () => {
    const logFile = join(STATE_DIR, "feat-running", "backend.log");
    mkdirSync(join(STATE_DIR, "feat-running"), { recursive: true });
    writeFileSync(logFile, "rodando\n");
    const run = fakeTmux("0");

    expect(await startService(service(logFile), run)).toBe("running");

    expect(run).toHaveBeenCalledTimes(1);
    expect(readFileSync(logFile, "utf8")).toBe("rodando\n");
  });

  test("sobe de novo um Serviço cujo processo morreu", async () => {
    const run = fakeTmux("1");

    expect(await startService(service(join(STATE_DIR, "feat-dead", "backend.log")), run)).toBe("started");

    const commands = run.mock.calls.map(([command]) => command[1]);
    expect(commands).toEqual(["display-message", "kill-session", "new-session"]);
  });

  test("falha com a mensagem do tmux quando a sessão não sobe", async () => {
    const run = mock((command: string[]) => Promise.resolve(command[1] === "new-session"
      ? createShellResult(command, { exitCode: 1, stderr: "duplicate session" })
      : createShellResult(command, { exitCode: 1 })));

    await expect(startService(service(join(STATE_DIR, "feat-err", "backend.log")), run))
      .rejects.toThrow("Falha ao criar a sessão tmux ns-feat-123-backend: duplicate session");
  });
});

describe("stopService", () => {
  test("derruba só a sessão de nome exato", async () => {
    const run = fakeTmux();
    await stopService("ns-feat-123-backend", run);
    expect(run).toHaveBeenCalledWith(["tmux", "kill-session", "-t", "=ns-feat-123-backend"], { silent: true });
  });

  test("não falha sem tmux", async () => {
    const run = mock(() => Promise.reject(new Error("ENOENT")));
    await expect(stopService("ns-feat-123-backend", run)).resolves.toBeUndefined();
  });
});

describe("hasTmux", () => {
  test("é falso quando o binário não existe", async () => {
    expect(await hasTmux(mock(() => Promise.reject(new Error("ENOENT"))))).toBe(false);
    expect(await hasTmux(fakeTmux())).toBe(true);
  });
});

test("attachCommand abre uma vista da sessão", () => {
  expect(attachCommand("ns-feat-123-backend")).toBe("tmux attach-session -t ns-feat-123-backend");
});
