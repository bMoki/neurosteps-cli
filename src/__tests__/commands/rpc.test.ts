import { describe, expect, test } from "bun:test";
import { join } from "path";
import { PassThrough } from "stream";
import { serveStdio, unconfigured } from "../../commands/rpc";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");

async function collect(stream: PassThrough): Promise<string> {
  let text = "";
  for await (const chunk of stream) text += String(chunk);
  return text;
}

describe("ns rpc pelo stdio", () => {
  test("stdout só recebe mensagens do protocolo, mesmo quando a operação usa console.log", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const stderrLines: unknown[][] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => { stderrLines.push(args); };

    try {
      const serving = serveStdio({
        input,
        output,
        operations: {
          barulhenta: async () => {
            console.log("log solto");
            console.info("info solta");
            return { ok: true };
          },
        },
      });
      input.end(`${JSON.stringify({ type: "op", id: "r1", op: "barulhenta" })}\n`);
      await serving;
      output.end();
    } finally {
      console.error = originalError;
    }

    const lines = (await collect(output)).trim().split("\n").map((line) => JSON.parse(line));
    expect(lines).toEqual([
      { type: "ready", protocol: 1, ops: ["barulhenta"] },
      { type: "result", id: "r1", result: { ok: true } },
    ]);
    expect(stderrLines).toEqual([["log solto"], ["info solta"]]);
  });

  test("perguntas e respostas atravessam o stdio", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const lines: Array<Record<string, unknown>> = [];
    let buffer = "";
    output.on("data", (chunk) => {
      buffer += String(chunk);
      const parts = buffer.split("\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        const message = JSON.parse(part);
        lines.push(message);
        if (message.type === "ask") {
          input.end(`${JSON.stringify({ type: "answer", id: message.id, ask: message.ask, value: true })}\n`);
        }
      }
    });

    const serving = serveStdio({
      input,
      output,
      operations: {
        pergunta: (_input, ctx) => ctx.ask({ id: "q", message: "Seguir?", default: false, whenUnavailable: "abort" }),
      },
    });
    input.write(`${JSON.stringify({ type: "op", id: "r1", op: "pergunta" })}\n`);
    await serving;

    expect(lines.map((m) => m.type)).toEqual(["ready", "ask", "result"]);
    expect(lines[2]).toEqual({ type: "result", id: "r1", result: true });
  });

  test("sem configuração, cada operação responde com pre-condicao", async () => {
    const operations = unconfigured({ status: async () => ({ branches: [] }) });

    expect(Object.keys(operations)).toEqual(["status"]);
    await expect(operations.status!({}, { emit() {}, ask: async () => false })).rejects.toMatchObject({ category: "pre-condicao" });
  });

  test("a saída de processo filho não silencioso vai para o stderr enquanto desviada", async () => {
    const script = [
      'import { exec, routeChildStdoutToStderr } from "./src/lib/shell";',
      "routeChildStdoutToStderr();",
      'await exec(["echo", "saida do filho"]);',
    ].join("\n");
    const child = Bun.spawn([process.execPath, "-e", script], { cwd: REPO_ROOT, stdout: "pipe", stderr: "pipe" });

    const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);

    expect(stdout).toBe("");
    expect(stderr).toContain("saida do filho");
  });

  test("o processo ns rpc responde em NDJSON e termina quando o stdin fecha", async () => {
    const child = Bun.spawn([process.execPath, "run", "src/index.ts", "rpc"], {
      cwd: REPO_ROOT,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    child.stdin.write('{"type":"op","id":"r1","op":"deploy"}\n');
    child.stdin.write("não é json\n");
    child.stdin.end();

    const [stdout, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited]);
    const lines = stdout.trim().split("\n").map((line) => JSON.parse(line));

    expect(exitCode).toBe(0);
    expect(lines[0]).toMatchObject({ type: "ready", protocol: 1 });
    expect(lines.slice(1).map((m) => [m.type, m.id, m.error.category])).toEqual([
      ["error", "r1", "protocolo"],
      ["error", null, "protocolo"],
    ]);
  }, 20_000);
});
