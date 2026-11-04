import { Command } from "commander";
import { createInterface } from "readline";
import type { Readable, Writable } from "stream";
import { preCondicao } from "../core";
import { isConfigured } from "../lib/env";
import { routeChildStdoutToStderr } from "../lib/shell";
import { type RpcOperations, createRpcOperations } from "../rpc/operations";
import { createRpcServer } from "../rpc/server";

export interface ServeStdioOptions {
  input: Readable;
  output: Writable;
  operations: RpcOperations;
}

export function rpcCommand(): Command {
  return new Command("rpc")
    .description("Serve as operações do núcleo em NDJSON pelo stdin/stdout, para IDEs e outros adapters")
    .action(async () => {
      // Cliente que fecha a leitura antes de nós (EPIPE) não pode derrubar as operações em andamento.
      process.stdout.on("error", () => {});
      const operations = isConfigured() ? createRpcOperations() : unconfigured(createRpcOperations());
      await serveStdio({ input: process.stdin, output: process.stdout, operations });
    });
}

/**
 * Lê uma mensagem por linha da entrada e escreve só mensagens do protocolo na saída.
 * Enquanto serve, `console.log` e a saída de processos filhos vão para o stderr, para não corromper o protocolo.
 */
export async function serveStdio(options: ServeStdioOptions): Promise<void> {
  const restoreConsole = routeConsoleToStderr();
  const restoreChildStdout = routeChildStdoutToStderr();
  try {
    const server = createRpcServer(options.operations, {
      write: (message) => options.output.write(`${JSON.stringify(message)}\n`),
      logError: (error) => console.error(error),
    });
    server.ready();

    const lines = createInterface({ input: options.input, crlfDelay: Infinity });
    for await (const line of lines) {
      server.receive(line);
    }
    await server.end();
  } finally {
    restoreChildStdout();
    restoreConsole();
  }
}

/** Sem configuração, o `ns rpc` sobe mesmo assim e responde cada operação com o erro, em vez de morrer calado. */
export function unconfigured(operations: RpcOperations): RpcOperations {
  const fail = async () => {
    throw preCondicao("CLI não configurado.", "Rode 'ns init' para configurar.");
  };
  return Object.fromEntries(Object.keys(operations).map((op) => [op, fail]));
}

function routeConsoleToStderr(): () => void {
  const { log, info, debug } = console;
  console.log = console.info = console.debug = (...args: unknown[]) => console.error(...args);
  return () => {
    console.log = log;
    console.info = info;
    console.debug = debug;
  };
}
