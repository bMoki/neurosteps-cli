import { Command } from "commander";
import { listBranches as defaultListBranches, resolveServiceLogFile } from "../lib/config";
import { detail, emptyLine, error, heading, info, ok, warn, colors } from "../lib/logger";
import { STALE_BRANCH_FLAG } from "../lib/branch-flags";
import {
  type BranchStatus,
  type NsError,
  type ServiceId,
  type ServiceKey,
  type ServiceState,
  createSilentContext,
  isNsError,
  runStatus,
} from "../core";

const BRANCH_COLUMN_WIDTH = 14;

export interface CompactStatusRow {
  branch: string;
  services: BranchStatus["services"];
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
  return Object.values(row.services).every((state) => state === null || state === "parado");
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
    services: status.services,
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

const PLAIN_STATE: Record<ServiceState, string> = {
  parado: "off",
  iniciando: "starting",
  rodando: "on",
  falhou: "failed",
};

const STATE_SYMBOL: Record<ServiceState, () => string> = {
  parado: () => colors.muted("○"),
  iniciando: () => colors.warn("◐"),
  rodando: () => colors.ok("●"),
  falhou: () => colors.err("✕"),
};

const plainState = (state: ServiceState | null) => (state === null ? "n/a" : PLAIN_STATE[state]);
const stateSymbol = (state: ServiceState | null) => (state === null ? colors.muted("—") : STATE_SYMBOL[state]());

export function renderCompactStatus(rows: CompactStatusRow[], plain = false): void {
  if (plain) {
    console.log("branch\tdb\tbackend\tfrontend\tmanager\treport-server\tflags");
    for (const row of sortCompactStatusRows(rows)) {
      const { db, backend, frontend, manager, reportServer } = row.services;
      const states = [db, backend, frontend, manager, reportServer].map(plainState);
      console.log([row.branch, ...states, row.flags.join(",")].join("\t"));
    }
    return;
  }

  console.log(colors.bold("\n  Branch        │ DB    │ Backend │ Frontend │ Manager │ Report │ Flags"));
  console.log(colors.muted("  ──────────────┼───────┼─────────┼──────────┼─────────┼────────┼──────"));

  for (const row of sortCompactStatusRows(rows)) {
    const { db, backend, frontend, manager, reportServer } = row.services;
    const flags = row.flags.includes(STALE_BRANCH_FLAG) ? colors.warn(STALE_BRANCH_FLAG) : colors.muted("—");

    const name = formatCompactBranchName(row.branch);
    console.log(`  ${name}│  ${stateSymbol(db)}    │    ${stateSymbol(backend)}    │     ${stateSymbol(frontend)}    │   ${stateSymbol(manager)}    │   ${stateSymbol(reportServer)}    │ ${flags}`);
  }
  console.log(colors.muted(`\n  ${STATE_SYMBOL.rodando()} Rodando  ${STATE_SYMBOL.iniciando()} Iniciando  ${STATE_SYMBOL.falhou()} Falhou  ${STATE_SYMBOL.parado()} Parado`));
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
  states: BranchStatus["services"];   // os quatro Estados; os booleanos acima são "está Rodando"
  repos: BranchStatus["repos"];
  flags: string[];
  stale: boolean;
  lastCommitAt: string | null;
  lastCliUsedAt: string | null;
  createdAt: string | null;
}

export interface StatusJsonError {
  error: { category: string; message: string; hint?: string };
}

function isRunning(state: ServiceState): boolean;
function isRunning(state: ServiceState | null): boolean | null;
function isRunning(state: ServiceState | null): boolean | null {
  return state === null ? null : state === "rodando";
}

export function toStatusJsonRow(status: BranchStatus): StatusJsonRow {
  return {
    branch: status.branch,
    db: status.services.db === "rodando",
    backend: isRunning(status.services.backend),
    frontend: isRunning(status.services.frontend),
    manager: isRunning(status.services.manager),
    reportServer: isRunning(status.services.reportServer),
    states: status.services,
    repos: status.repos,
    flags: status.flags,
    stale: status.stale,
    lastCommitAt: status.lastCommitAt,
    lastCliUsedAt: status.lastCliUsedAt,
    createdAt: status.createdAt,
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
    for (const { repo, gitBranch } of status.repos) console.log(`repo\t${repo}\t${gitBranch ?? "-"}`);
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
    if (status.repos.length > 0) detail("Repos", status.repos.map(describeRepo).join(", "));
  }

  if (status.services.db === "rodando") {
    ok(`DB rodando (${status.dbContainer})`);
  } else {
    warn("DB parado");
  }

  for (const service of DETAIL_SERVICES) renderServiceState(status, service);

  if (status.stale) {
    warn(`Flag ${STALE_BRANCH_FLAG}: sem commit e sem uso da CLI há mais de 7 dias`);
  }
}

function describeRepo({ repo, gitBranch }: BranchStatus["repos"][number]): string {
  return `${repo} (${gitBranch ?? "sem branch"})`;
}

const DETAIL_SERVICES: Array<{ key: ServiceKey; id: ServiceId; label: string }> = [
  { key: "backend", id: "backend", label: "Backend" },
  { key: "frontend", id: "frontend", label: "Frontend" },
  { key: "manager", id: "manager", label: "Manager" },
  { key: "reportServer", id: "report-server", label: "Report-server" },
];

function renderServiceState(status: BranchStatus, { key, id, label }: (typeof DETAIL_SERVICES)[number]): void {
  const state = status.services[key];
  const alias = status.aliases[key];
  if (state === null) return;
  if (state === "rodando") ok(`${label} rodando (${alias})`);
  else if (state === "iniciando") info(`${label} iniciando: a porta ainda não responde`);
  else if (state === "falhou") error(`${label} falhou. Log: ${resolveServiceLogFile(status.branch, id)}`);
  else warn(`${label} parado`);
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
