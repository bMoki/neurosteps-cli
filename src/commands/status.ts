import { Command } from "commander";
import { WORKTREES_DIR, readWorkspaceEnv, PRODUCT_NAME, listBranches } from "../lib/config";
import { dockerPs } from "../lib/docker";
import { listAliases } from "../lib/portless";
import { detail, emptyLine, error, heading, ok, warn, colors } from "../lib/logger";
import { join } from "path";

const BRANCH_COLUMN_WIDTH = 14;

export interface CompactStatusRow {
  branch: string;
  dbRunning: boolean;
  backendRunning: boolean;
  frontendRunning: boolean;
  managerRunning: boolean | null;
  reportServerRunning: boolean | null;
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

export function statusCommand(): Command {
  return new Command("status")
    .description("Mostra status dos serviços")
    .argument("[branch]", "nome da branch")
    .option("-a, --all", "mostra detalhes de todas as branches")
    .option("--json", "emite saída em JSON (stdout)")
    .option("--plain", "saída sem formatação para grep/pipe")
    .action(async (branch, opts) => {
      if (opts.json) {
        await showJsonStatus(branch);
      } else if (branch) {
        await showBranchStatus(branch, opts.plain);
      } else if (opts.all) {
        await showAllStatus(opts.plain);
      } else {
        await showCompactStatus(opts.plain);
      }
    });
}

async function buildRows(branch?: string): Promise<CompactStatusRow[]> {
  const branches = branch ? [branch] : listBranches();
  const aliases = await listAliases();
  const hasAlias = (alias: string) => aliases.some((a) => a.toLowerCase().includes(alias.toLowerCase()));
  const rows: CompactStatusRow[] = [];

  for (const b of branches) {
    const env = await readWorkspaceEnv(b);
    if (!env) continue;

    const dbRunning = await dockerPs(env.DB_CONTAINER);
    const aliasSlug = env.BRANCH_SLUG || b.toLowerCase();
    const apiAlias = `${aliasSlug}.api.${PRODUCT_NAME}`;
    const webAlias = `${aliasSlug}.web.${PRODUCT_NAME}`;
    const mgrAlias = `${aliasSlug}.manager.${PRODUCT_NAME}`;
    const rsAlias = `${aliasSlug}.report-server.${PRODUCT_NAME}`;

    rows.push({
      branch: b,
      dbRunning,
      backendRunning: hasAlias(apiAlias),
      frontendRunning: hasAlias(webAlias),
      managerRunning: env.MANAGER_PORT ? hasAlias(mgrAlias) : null,
      reportServerRunning: env.REPORT_SERVER_PORT ? hasAlias(rsAlias) : null,
    });
  }
  return rows;
}

async function showCompactStatus(plain = false): Promise<void> {
  const branches = listBranches();
  if (branches.length === 0) {
    console.log("Nenhuma branch encontrada.");
    return;
  }

  const rows = await buildRows();

  if (plain) {
    console.log("branch\tdb\tbackend\tfrontend\tmanager\treport-server");
    for (const row of sortCompactStatusRows(rows)) {
      const mgr = row.managerRunning === null ? "n/a" : row.managerRunning ? "on" : "off";
      const rs = row.reportServerRunning === null ? "n/a" : row.reportServerRunning ? "on" : "off";
      console.log(`${row.branch}\t${row.dbRunning ? "on" : "off"}\t${row.backendRunning ? "on" : "off"}\t${row.frontendRunning ? "on" : "off"}\t${mgr}\t${rs}`);
    }
    return;
  }

  console.log(colors.bold("\n  Branch        │ DB    │ Backend │ Frontend │ Manager │ Report"));
  console.log(colors.muted("  ──────────────┼───────┼─────────┼──────────┼─────────┼───────"));

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

    const name = formatCompactBranchName(row.branch);
    console.log(`  ${name}│  ${dbStatus}    │    ${backendStatus}    │     ${frontendStatus}    │   ${managerStatus}    │   ${reportServerStatus}`);
  }
  console.log();
}

async function showJsonStatus(branch?: string): Promise<void> {
  const rows = await buildRows(branch);
  const output = rows.map((row) => ({
    branch: row.branch,
    db: row.dbRunning,
    backend: row.backendRunning,
    frontend: row.frontendRunning,
    manager: row.managerRunning,
    reportServer: row.reportServerRunning,
  }));
  process.stdout.write(JSON.stringify(branch ? output[0] ?? null : output, null, 2) + "\n");
}

async function showBranchStatus(branch: string, plain = false): Promise<void> {
  const env = await readWorkspaceEnv(branch);
  if (!env) {
    error(`Worktree não encontrada para '${branch}'`);
    process.exitCode = 1;
    return;
  }

  if (plain) {
    console.log(`path\t${join(WORKTREES_DIR, branch)}`);
    console.log(`db\tlocalhost:${env.DB_PORT}`);
    console.log(`backend\tlocalhost:${env.BACKEND_PORT}`);
    console.log(`frontend\tlocalhost:${env.FRONTEND_PORT}`);
    if (env.MANAGER_PORT) console.log(`manager\tlocalhost:${env.MANAGER_PORT}`);
    if (env.REPORT_SERVER_PORT) console.log(`report-server\tlocalhost:${env.REPORT_SERVER_PORT}`);
  } else {
    heading(`Branch: ${branch}`);
    detail("Path", join(WORKTREES_DIR, branch));
    detail("DB", `localhost:${env.DB_PORT}`);
    detail("Backend", `localhost:${env.BACKEND_PORT}`);
    detail("Frontend", `localhost:${env.FRONTEND_PORT}`);
    if (env.MANAGER_PORT) {
      detail("Manager", `localhost:${env.MANAGER_PORT}`);
    }
    if (env.REPORT_SERVER_PORT) {
      detail("Report-server", `localhost:${env.REPORT_SERVER_PORT}`);
    }
  }

  const dbRunning = await dockerPs(env.DB_CONTAINER);
  if (dbRunning) {
    ok(`DB rodando (${env.DB_CONTAINER})`);
  } else {
    warn("DB parado");
  }

  const aliases = await listAliases();
  const aliasSlug = env.BRANCH_SLUG || branch.toLowerCase();
  const apiAlias = `${aliasSlug}.api.${PRODUCT_NAME}`;
  const webAlias = `${aliasSlug}.web.${PRODUCT_NAME}`;
  const mgrAlias = `${aliasSlug}.manager.${PRODUCT_NAME}`;
  const rsAlias = `${aliasSlug}.report-server.${PRODUCT_NAME}`;
  const hasAlias = (alias: string) => aliases.some((a) => a.toLowerCase().includes(alias.toLowerCase()));

  if (hasAlias(apiAlias)) {
    ok(`Backend ativo (${apiAlias})`);
  } else {
    warn("Backend sem alias Portless");
  }

  if (hasAlias(webAlias)) {
    ok(`Frontend ativo (${webAlias})`);
  } else {
    warn("Frontend sem alias Portless");
  }

  if (env.MANAGER_PORT) {
    if (hasAlias(mgrAlias)) {
      ok(`Manager ativo (${mgrAlias})`);
    } else {
      warn("Manager sem alias Portless");
    }
  }

  if (env.REPORT_SERVER_PORT) {
    if (hasAlias(rsAlias)) {
      ok(`Report-server ativo (${rsAlias})`);
    } else {
      warn("Report-server sem alias Portless");
    }
  }
}

async function showAllStatus(plain = false): Promise<void> {
  const branches = listBranches();
  for (const branch of branches) {
    await showBranchStatus(branch, plain);
    emptyLine();
  }
}
