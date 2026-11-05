import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import {
  type CompactStatusRow,
  formatCompactBranchName,
  isCompactStatusRowFullyOff,
  renderBranchDetail,
  renderCompactStatus,
  sortCompactStatusRows,
  statusCommand,
  toCompactRow,
  toStatusJson,
  toStatusJsonError,
} from "../../commands/status";
import { type BranchStatus, naoEncontrado } from "../../core";
import { PRODUCT_NAME } from "../../lib/config";

function row(overrides: Partial<CompactStatusRow>): CompactStatusRow {
  return {
    branch: "branch",
    services: { db: "parado", backend: "parado", frontend: "parado", manager: null, reportServer: null },
    flags: [],
    stale: false,
    lastCommitAt: null,
    lastCliUsedAt: null,
    ...overrides,
  };
}

function status(overrides: Partial<BranchStatus> = {}): BranchStatus {
  return {
    branch: "feat-123",
    slug: "feat-123",
    path: "/tmp/worktrees/feat-123",
    dbContainer: "myapp-psql-feat-123",
    ports: { db: 5438, backend: 8084, frontend: 3015 },
    services: { db: "rodando", backend: "rodando", frontend: "parado", manager: null, reportServer: null },
    aliases: { backend: `feat-123.api.${PRODUCT_NAME}`, frontend: `feat-123.web.${PRODUCT_NAME}` },
    sessions: { backend: "ns-feat-123-backend", frontend: "ns-feat-123-frontend" },
    errors: {},
    flags: [],
    stale: false,
    lastCommitAt: null,
    lastCliUsedAt: null,
    ...overrides,
  };
}

/** Captura o que os renderizadores escrevem: stdout via console.log, stderr via logger. */
function captureOutput() {
  const out: string[] = [];
  const err: string[] = [];
  const stdout: string[] = [];

  const logSpy = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    out.push(args.map(String).join(" "));
  });
  const errorSpy = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    err.push(args.map(String).join(" "));
  });
  const writeSpy = spyOn(process.stdout, "write").mockImplementation(((chunk: string) => {
    stdout.push(String(chunk));
    return true;
  }) as typeof process.stdout.write);

  return {
    out,
    err,
    get stdout() { return stdout.join(""); },
    restore() {
      logSpy.mockRestore();
      errorSpy.mockRestore();
      writeSpy.mockRestore();
    },
  };
}

let captured: ReturnType<typeof captureOutput> | undefined;

afterEach(() => {
  captured?.restore();
  captured = undefined;
  process.exitCode = 0;
});

async function run(args: string[], deps: {
  readStatus?: (branch?: string) => Promise<BranchStatus[]>;
  listBranches?: () => string[];
} = {}) {
  captured = captureOutput();
  await statusCommand({
    readStatus: deps.readStatus ?? (async () => [status()]),
    listBranches: deps.listBranches ?? (() => ["feat-123"]),
  }).parseAsync(args, { from: "user" });
  return captured;
}

describe("status compact helpers", () => {
  test("truncates long branch names to the table width", () => {
    expect(formatCompactBranchName("feat-123")).toBe("feat-123      ");
    expect(formatCompactBranchName("feature-very-long-branch")).toBe("feature-ver...");
  });

  test("moves fully-off rows to the end", () => {
    const rows: CompactStatusRow[] = [
      row({
        branch: "inactive-no-manager",
      }),
      row({
        branch: "partial",
        services: { ...row({}).services, backend: "rodando" },
      }),
      row({
        branch: "failed-manager",
        services: { ...row({}).services, manager: "falhou" },
      }),
      row({
        branch: "inactive-manager",
        services: { ...row({}).services, manager: "parado" },
      }),
      row({
        branch: "starting",
        services: { ...row({}).services, frontend: "iniciando" },
      }),
    ];

    expect(isCompactStatusRowFullyOff(rows[0]!)).toBe(true);
    expect(sortCompactStatusRows(rows).map((row) => row.branch)).toEqual([
      "partial",
      "failed-manager",
      "starting",
      "inactive-no-manager",
      "inactive-manager",
    ]);
    expect(rows.map((row) => row.branch)[0]).toBe("inactive-no-manager");
  });

  test("toCompactRow achata os serviços do núcleo", () => {
    expect(toCompactRow(status({ flags: ["stale"], stale: true }))).toEqual({
      branch: "feat-123",
      services: { db: "rodando", backend: "rodando", frontend: "parado", manager: null, reportServer: null },
      flags: ["stale"],
      stale: true,
      lastCommitAt: null,
      lastCliUsedAt: null,
    });
  });
});

describe("tabela compacta", () => {
  test("--plain emite cabeçalho e uma linha por branch, com os quatro estados e n/a para serviço ausente", async () => {
    const { out } = await run(["--plain"], {
      readStatus: async () => [
        status(),
        status({ branch: "outra", services: { db: "parado", backend: "iniciando", frontend: "falhou", manager: "rodando", reportServer: "parado" } }),
      ],
    });

    expect(out[0]).toBe("branch\tdb\tbackend\tfrontend\tmanager\treport-server\tflags");
    expect(out).toContain("feat-123\ton\ton\toff\tn/a\tn/a\t");
    expect(out).toContain("outra\toff\tstarting\tfailed\ton\toff\t");
  });

  test("tabela mostra um símbolo por estado e a legenda", async () => {
    const { out } = await run([], {
      readStatus: async () => [
        status({ services: { db: "rodando", backend: "iniciando", frontend: "falhou", manager: "parado", reportServer: null } }),
      ],
    });

    const line = out.find((l) => l.includes("feat-123"))!;
    for (const symbol of ["●", "◐", "✕", "○", "—"]) expect(line).toContain(symbol);
    expect(out.join("\n")).toContain("Rodando");
    expect(out.join("\n")).toContain("Falhou");
  });

  test("--plain junta as flags por vírgula", () => {
    captured = captureOutput();
    renderCompactStatus([toCompactRow(status({ flags: ["stale", "outra"] }))], true);

    expect(captured.out[1]).toEndWith("\tstale,outra");
  });

  test("tabela ordena as branches desligadas por último", async () => {
    const { out } = await run([], {
      listBranches: () => ["ligada", "desligada"],
      readStatus: async () => [
        status({ branch: "desligada", services: { db: "parado", backend: "parado", frontend: "parado", manager: null, reportServer: null } }),
        status({ branch: "ligada" }),
      ],
    });

    const body = out.filter((line) => line.includes("│") && !line.includes("Branch"));
    expect(body[0]).toContain("ligada");
    expect(body[1]).toContain("desligada");
  });

  test("workspace sem branch nenhuma avisa em vez de imprimir tabela vazia", async () => {
    const readStatus = mock(async () => []);
    const { out } = await run([], { listBranches: () => [], readStatus });

    expect(out).toEqual(["Nenhuma branch encontrada."]);
    expect(readStatus).not.toHaveBeenCalled();
  });
});

describe("--json", () => {
  test("array quando não recebe branch", async () => {
    const { stdout } = await run(["--json"], {
      readStatus: async () => [status(), status({ branch: "outra" })],
    });

    const parsed = JSON.parse(stdout);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.map((r: { branch: string }) => r.branch)).toEqual(["feat-123", "outra"]);
  });

  test("objeto com as chaves do contrato quando recebe branch", async () => {
    const { stdout } = await run(["--json", "feat-123"]);

    expect(JSON.parse(stdout)).toEqual({
      branch: "feat-123",
      db: true,
      backend: true,
      frontend: false,
      manager: null,
      reportServer: null,
      states: { db: "rodando", backend: "rodando", frontend: "parado", manager: null, reportServer: null },
      flags: [],
      stale: false,
      lastCommitAt: null,
      lastCliUsedAt: null,
    });
  });

  test("os booleanos dizem só se está Rodando; os estados vão em states", async () => {
    const { stdout } = await run(["--json", "feat-123"], {
      readStatus: async () => [status({
        ports: { db: 5438, backend: 8084, frontend: 3015, manager: 3021 },
        services: { db: "parado", backend: "iniciando", frontend: "falhou", manager: "rodando", reportServer: null },
      })],
    });

    const parsed = JSON.parse(stdout);
    expect([parsed.db, parsed.backend, parsed.frontend, parsed.manager, parsed.reportServer])
      .toEqual([false, false, false, true, null]);
    expect(parsed.states.frontend).toBe("falhou");
  });

  test("branch inexistente vira documento de erro, não null", async () => {
    const { stdout } = await run(["--json", "nao-existe"], {
      readStatus: async () => {
        throw naoEncontrado("Worktree não encontrada para 'nao-existe'", "Rode 'ns status'.");
      },
    });

    expect(JSON.parse(stdout)).toEqual({
      error: {
        category: "nao-encontrado",
        message: "Worktree não encontrada para 'nao-existe'",
        hint: "Rode 'ns status'.",
      },
    });
  });

  test("saída sempre termina com newline e é JSON parseável", async () => {
    const { stdout } = await run(["--json"]);

    expect(stdout).toEndWith("\n");
    expect(() => JSON.parse(stdout)).not.toThrow();
  });

  test("erro inesperado não vira JSON: sobe para o adapter", async () => {
    captured = captureOutput();
    const command = statusCommand({
      readStatus: async () => { throw new Error("docker morreu"); },
      listBranches: () => ["feat-123"],
    });

    await expect(command.parseAsync(["--json"], { from: "user" })).rejects.toThrow("docker morreu");
  });

  test("toStatusJson e toStatusJsonError são puros", () => {
    expect(toStatusJson([], "x")).toBeNull();
    expect(toStatusJson([])).toEqual([]);
    expect(toStatusJsonError(naoEncontrado("sumiu"))).toEqual({
      error: { category: "nao-encontrado", message: "sumiu" },
    });
  });
});

describe("detalhe de uma branch", () => {
  test("--plain lista path e portas, omitindo serviços ausentes", () => {
    captured = captureOutput();
    renderBranchDetail(status(), true);

    expect(captured.out).toEqual([
      "path\t/tmp/worktrees/feat-123",
      "db\tlocalhost:5438",
      "backend\tlocalhost:8084",
      "frontend\tlocalhost:3015",
    ]);
  });

  test("--plain inclui manager e report-server quando existem", () => {
    captured = captureOutput();
    renderBranchDetail(status({
      ports: { db: 5438, backend: 8084, frontend: 3015, manager: 3021, reportServer: 9001 },
    }), true);

    expect(captured.out).toContain("manager\tlocalhost:3021");
    expect(captured.out).toContain("report-server\tlocalhost:9001");
  });

  test("formato humano nomeia o container e os aliases ativos", () => {
    captured = captureOutput();
    renderBranchDetail(status());

    const stderr = captured.err.join("\n");
    expect(stderr).toContain("Branch: feat-123");
    expect(stderr).toContain("DB rodando (myapp-psql-feat-123)");
    expect(stderr).toContain(`Backend rodando (feat-123.api.${PRODUCT_NAME})`);
    expect(stderr).toContain("Frontend parado");
  });

  test("nomeia cada estado e aponta o log de quem falhou", () => {
    captured = captureOutput();
    renderBranchDetail(status({
      ports: { db: 5438, backend: 8084, frontend: 3015, manager: 3021, reportServer: 9001 },
      services: { db: "parado", backend: "iniciando", frontend: "falhou", manager: "parado", reportServer: "parado" },
    }));

    const stderr = captured.err.join("\n") + captured.out.join("\n");
    expect(stderr).toContain("DB parado");
    expect(stderr).toContain("Backend iniciando");
    expect(stderr).toMatch(/Frontend falhou\. Log: .*\/feat-123\/frontend\.log/);
    expect(stderr).toContain("Manager parado");
    expect(stderr).toContain("Report-server parado");
  });

  test("reporta a flag stale", () => {
    captured = captureOutput();
    renderBranchDetail(status({ flags: ["stale"], stale: true }));

    expect(captured.err.join("\n")).toContain("Flag stale");
  });
});

describe("--all", () => {
  test("percorre todas as branches na ordem do workspace com uma leitura só", async () => {
    const readStatus = mock(async (branch?: string) =>
      branch ? [status({ branch })] : [status({ branch: "b" }), status({ branch: "a" })]);

    const { err } = await run(["--all"], { listBranches: () => ["a", "b"], readStatus });

    const headings = err.filter((line) => line.includes("Branch:"));
    expect(headings[0]).toContain("Branch: a");
    expect(headings[1]).toContain("Branch: b");
    expect(readStatus).toHaveBeenCalledTimes(1);
    expect(process.exitCode ?? 0).toBe(0);
  });

  test("entrada sem worktree é reportada e não interrompe o resto", async () => {
    const { err } = await run(["--all"], {
      listBranches: () => ["AGENTS.md", "feat-123"],
      readStatus: async (branch) => {
        if (!branch) return [status({ branch: "feat-123" })];
        if (branch === "AGENTS.md") throw naoEncontrado("Worktree não encontrada para 'AGENTS.md'", "ignorado no -a");
        return [status({ branch })];
      },
    });

    const joined = err.join("\n");
    expect(joined).toContain("Worktree não encontrada para 'AGENTS.md'");
    expect(joined).not.toContain("ignorado no -a");
    expect(joined).toContain("Branch: feat-123");
    expect(process.exitCode).toBe(1);
  });

  test("erro que não é nao-encontrado interrompe o -a", async () => {
    captured = captureOutput();
    const command = statusCommand({
      listBranches: () => ["a", "b"],
      readStatus: async () => { throw new Error("portless morreu"); },
    });

    await expect(command.parseAsync(["--all"], { from: "user" })).rejects.toThrow("portless morreu");
  });
});
