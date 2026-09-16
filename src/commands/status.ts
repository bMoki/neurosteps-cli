import { Command } from "commander";
import { listBranches as defaultListBranches } from "../lib/config";
import { detail, emptyLine, error, heading, ok, warn, colors } from "../lib/logger";
import { STALE_BRANCH_FLAG } from "../lib/branch-flags";
import { type BranchStatus, type NsError, createSilentContext, isNsError, runStatus } from "../core";

const BRANCH_COLUMN_WIDTH = 14;

export interface CompactStatusRow {
  branch: string;
  dbRunning: boolean;
  backendRunning: boolean;
  frontendRunning: boolean;
  managerRunning: boolean | null;
  reportServerRunning: boolean | null;
  flags: string[];
  stale: boolean;
  lastCommitAt: string | null;
  lastCliUsedAt: string | null;
}

export interface StatusCommandDeps {
  readStatus: (branch?: string) => Promise<BranchStatus[]>;
  listBranches: typeof defaultListBranches;
}

export function formatCompactBranchName(branch: string): string {
  const truncated = branch.length > BRANCH_COLUMN_WIDTH
    ? `${branch.slice(0, BRANCH_COLUMN_WIDTH - 3)}...`
    : branch;
  return truncated.padEnd(BRANCH_COLUMN_WIDTH);
}

export function isCompactStatusRowFullyOff(row: CompactStatusRow): boolean {
  return !row.dbRunning
    && !row.backendRunning
    && !row.frontendRunning
    && row.managerRunning !== true
    && row.reportServerRunning !== true;
}

export function sortCompactStatusRows(rows: CompactStatusRow[]): CompactStatusRow[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const offOrder = Number(isCompactStatusRowFullyOff(a.row)) - Number(isCompactStatusRowFullyOff(b.row));
      return offOrder || a.index - b.index;
    })
    .map(({ row }) => row);
}

export function toCompactRow(status: BranchStatus): CompactStatusRow {
  return {
    branch: status.branch,
    dbRunning: status.services.db,
    backendRunning: status.services.backend,
    frontendRunning: status.services.frontend,
    managerRunning: status.services.manager,
    reportServerRunning: status.services.reportServer,
    flags: status.flags,
    stale: status.stale,
    lastCommitAt: status.lastCommitAt,
    lastCliUsedAt: status.lastCliUsedAt,
  };
}

async function defaultReadStatus(branch?: string): Promise<BranchStatus[]> {
  const result = await runStatus(branch ? { branch } : {}, createSilentContext());
  return result.branches;
}

export function statusCommand(deps: Partial<StatusCommandDeps> = {}): Command {
  const readStatus = deps.readStatus ?? defaultReadStatus;
  const listBranches = deps.listBranches ?? defaultListBranches;

  return new Command("status")
    .description("Mostra status dos serviços")
    .argument("[branch]", "nome da branch")
    .option("-a, --all", "mostra detalhes de todas as branches")
    .option("--json", "emite saída em JSON (stdout)")
    .option("--plain", "saída sem formatação para grep/pipe")
    .action(async (branch, opts) => {
      if (opts.json) {
        await showJsonStatus(readStatus, branch);
      } else if (branch) {
        renderBranchDetail((await readStatus(branch))[0]!, opts.plain);
      } else if (opts.all) {
        await showAllStatus(readStatus, listBranches, opts.plain);
      } else {
        await showCompactStatus(readStatus, listBranches, opts.plain);
      }
    });
}

// ─── Tabela compacta ───

async function showCompactStatus(
  readStatus: StatusCommandDeps["readStatus"],
  listBranches: StatusCommandDeps["listBranches"],
  plain = false,
): Promise<void> {
  if (listBranches().length === 0) {
    console.log("Nenhuma branch encontrada.");
    return;
  }

  renderCompactStatus((await readStatus()).map(toCompactRow), plain);
}

export function renderCompactStatus(rows: CompactStatusRow[], plain = false): void {
  if (plain) {
    console.log("branch\tdb\tbackend\tfrontend\tmanager\treport-server\tflags");
    for (const row of sortCompactStatusRows(rows)) {
      const mgr = row.managerRunning === null ? "n/a" : row.managerRunning ? "on" : "off";
      const rs = row.reportServerRunning === null ? "n/a" : row.reportServerRunning ? "on" : "off";
      console.log(`${row.branch}\t${row.dbRunning ? "on" : "off"}\t${row.backendRunning ? "on" : "off"}\t${row.frontendRunning ? "on" : "off"}\t${mgr}\t${rs}\t${row.flags.join(",")}`);
    }
    return;
  }

  console.log(colors.bold("\n  Branch        │ DB    │ Backend │ Frontend │ Manager │ Report │ Flags"));
  console.log(colors.muted("  ──────────────┼───────┼─────────┼──────────┼─────────┼────────┼──────"));

  for (const row of sortCompactStatusRows(rows)) {
    const dbStatus = row.dbRunning ? colors.ok("●") : colors.err("○");
    const backendStatus = row.backendRunning ? colors.ok("●") : colors.err("○");
    const frontendStatus = row.frontendRunning ? colors.ok("●") : colors.err("○");
    const managerStatus = row.managerRunning === null
      ? colors.muted("—")
      : row.managerRunning ? colors.ok("●") : colors.err("○");
    const reportServerStatus = row.reportServerRunning === null
      ? colors.muted("—")
      : row.reportServerRunning ? colors.ok("●") : colors.err("○");
    const flags = row.flags.includes(STALE_BRANCH_FLAG) ? colors.warn(STALE_BRANCH_FLAG) : colors.muted("—");

    const name = formatCompactBranchName(row.branch);
    console.log(`  ${name}│  ${dbStatus}    │    ${backendStatus}    │     ${frontendStatus}    │   ${managerStatus}    │   ${reportServerStatus}    │ ${flags}`);
  }
  console.log();
}

// ─── JSON ───

export interface StatusJsonRow {
  branch: string;
  db: boolean;
  backend: boolean;
  frontend: boolean;
  manager: boolean | null;
  reportServer: boolean | null;
  flags: string[];
  stale: boolean;
  lastCommitAt: string | null;
  lastCliUsedAt: string | null;
}

export interface StatusJsonError {
  error: { category: string; message: string; hint?: string };
}

export function toStatusJsonRow(status: BranchStatus): StatusJsonRow {
  return {
    branch: status.branch,
    db: status.services.db,
    backend: status.services.backend,
    frontend: status.services.frontend,
    manager: status.services.manager,
    reportServer: status.services.reportServer,
    flags: status.flags,
    stale: status.stale,
    lastCommitAt: status.lastCommitAt,
    lastCliUsedAt: status.lastCliUsedAt,
  };
}

/** Objeto quando a branch foi pedida por nome, array quando não — contrato público do `--json`. */
export function toStatusJson(
  statuses: BranchStatus[],
  branch?: string,
): StatusJsonRow | StatusJsonRow[] | null {
  const rows = statuses.map(toStatusJsonRow);
  return branch ? rows[0] ?? null : rows;
}

export function toStatusJsonError(err: NsError): StatusJsonError {
  return {
    error: {
      category: err.category,
      message: err.message,
      ...(err.hint ? { hint: err.hint } : {}),
    },
  };
}

async function showJsonStatus(
  readStatus: StatusCommandDeps["readStatus"],
  branch?: string,
): Promise<void> {
  // Falha conhecida vira documento JSON: quem consome `--json` nunca precisa ler stderr.
  const payload = await readStatus(branch).then(
    (statuses) => toStatusJson(statuses, branch),
    (err: unknown) => {
      if (!isNsError(err)) throw err;
      return toStatusJsonError(err);
    },
  );

  process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
}

// ─── Detalhe de uma branch ───

export function renderBranchDetail(status: BranchStatus, plain = false): void {
  if (plain) {
    console.log(`path\t${status.path}`);
    console.log(`db\tlocalhost:${status.ports.db}`);
    console.log(`backend\tlocalhost:${status.ports.backend}`);
    console.log(`frontend\tlocalhost:${status.ports.frontend}`);
    if (status.ports.manager) console.log(`manager\tlocalhost:${status.ports.manager}`);
    if (status.ports.reportServer) console.log(`report-server\tlocalhost:${status.ports.reportServer}`);
  } else {
    heading(`Branch: ${status.branch}`);
    detail("Path", status.path);
    detail("DB", `localhost:${status.ports.db}`);
    detail("Backend", `localhost:${status.ports.backend}`);
    detail("Frontend", `localhost:${status.ports.frontend}`);
    if (status.ports.manager) {
      detail("Manager", `localhost:${status.ports.manager}`);
    }
    if (status.ports.reportServer) {
      detail("Report-server", `localhost:${status.ports.reportServer}`);
    }
  }

  if (status.services.db) {
    ok(`DB rodando (${status.dbContainer})`);
  } else {
    warn("DB parado");
  }

  if (status.services.backend) {
    ok(`Backend ativo (${status.aliases.backend})`);
  } else {
    warn("Backend sem alias Portless");
  }

  if (status.services.frontend) {
    ok(`Frontend ativo (${status.aliases.frontend})`);
  } else {
    warn("Frontend sem alias Portless");
  }

  if (status.ports.manager) {
    if (status.services.manager) {
      ok(`Manager ativo (${status.aliases.manager})`);
    } else {
      warn("Manager sem alias Portless");
    }
  }

  if (status.ports.reportServer) {
    if (status.services.reportServer) {
      ok(`Report-server ativo (${status.aliases.reportServer})`);
    } else {
      warn("Report-server sem alias Portless");
    }
  }

  if (status.stale) {
    warn(`Flag ${STALE_BRANCH_FLAG}: sem commit e sem uso da CLI há mais de 7 dias`);
  }
}

async function showAllStatus(
  readStatus: StatusCommandDeps["readStatus"],
  listBranches: StatusCommandDeps["listBranches"],
  plain = false,
): Promise<void> {
  // Uma leitura só para todas as branches; a ordem de exibição é a do workspace.
  const byBranch = new Map((await readStatus()).map((status) => [status.branch, status]));

  for (const branch of listBranches()) {
    const status = byBranch.get(branch);
    if (status) {
      renderBranchDetail(status, plain);
    } else {
      // Entrada que não é worktree: relida sozinha para que a falha venha do núcleo,
      // reportada sem parar o resto. Sem hint — quem roda `-a` já vê a lista inteira.
      try {
        renderBranchDetail((await readStatus(branch))[0]!, plain);
      } catch (err) {
        if (!isNsError(err) || err.category !== "nao-encontrado") throw err;
        error(err.message);
        process.exitCode = 1;
      }
    }
    emptyLine();
  }
}
