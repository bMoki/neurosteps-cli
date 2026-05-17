import { Command } from "commander";
import { WORKTREES_DIR, readWorkspaceEnv, PRODUCT_NAME, listBranches } from "../lib/config";
import { dockerPs } from "../lib/docker";
import { listAliases } from "../lib/portless";
import { detail, emptyLine, error, heading, ok, warn, colors } from "../lib/logger";
import { join } from "path";
import chalk from "chalk";

const BRANCH_COLUMN_WIDTH = 14;

export interface CompactStatusRow {
  branch: string;
  dbRunning: boolean;
  backendRunning: boolean;
  frontendRunning: boolean;
  managerRunning: boolean | null;
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
    && row.managerRunning !== true;
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
    .option("--all", "mostra detalhes de todas as branches")
    .action(async (branch, opts) => {
      if (branch) {
        await showBranchStatus(branch);
      } else if (opts.all) {
        await showAllStatus();
      } else {
        await showCompactStatus();
      }
    });
}

async function showCompactStatus(): Promise<void> {
  const branches = listBranches();
  if (branches.length === 0) {
    console.log("Nenhuma branch encontrada.");
    return;
  }

  const aliases = await listAliases();
  const hasAlias = (alias: string) => aliases.some((a) => a.toLowerCase().includes(alias.toLowerCase()));
  const rows: CompactStatusRow[] = [];

  for (const branch of branches) {
    const env = await readWorkspaceEnv(branch);
    if (!env) continue;

    const dbRunning = await dockerPs(env.DB_CONTAINER);
    const aliasSlug = env.BRANCH_SLUG || branch.toLowerCase();
    const apiAlias = `${aliasSlug}.api.${PRODUCT_NAME}`;
    const webAlias = `${aliasSlug}.web.${PRODUCT_NAME}`;
    const mgrAlias = `${aliasSlug}.manager.${PRODUCT_NAME}`;

    rows.push({
      branch,
      dbRunning,
      backendRunning: hasAlias(apiAlias),
      frontendRunning: hasAlias(webAlias),
      managerRunning: env.MANAGER_PORT ? hasAlias(mgrAlias) : null,
    });
  }

  console.log(chalk.bold("\n  Branch        │ DB    │ Backend │ Frontend │ Manager"));
  console.log(chalk.gray("  ──────────────┼───────┼─────────┼──────────┼────────"));

  for (const row of sortCompactStatusRows(rows)) {
    const dbStatus = row.dbRunning ? colors.ok("●") : colors.err("○");
    const backendStatus = row.backendRunning ? colors.ok("●") : colors.err("○");
    const frontendStatus = row.frontendRunning ? colors.ok("●") : colors.err("○");
    const managerStatus = row.managerRunning === null
      ? chalk.gray("—")
      : row.managerRunning ? colors.ok("●") : colors.err("○");

    const name = formatCompactBranchName(row.branch);
    console.log(`  ${name}│  ${dbStatus}    │    ${backendStatus}    │     ${frontendStatus}    │   ${managerStatus}`);
  }
  console.log();
}

async function showBranchStatus(branch: string): Promise<void> {
  const env = await readWorkspaceEnv(branch);
  if (!env) {
    error(`Worktree não encontrada para '${branch}'`);
    return;
  }

  heading(`Branch: ${branch}`);
  detail("Path", join(WORKTREES_DIR, branch));
  detail("DB", `localhost:${env.DB_PORT}`);
  detail("Backend", `localhost:${env.BACKEND_PORT}`);
  detail("Frontend", `localhost:${env.FRONTEND_PORT}`);
  if (env.MANAGER_PORT) {
    detail("Manager", `localhost:${env.MANAGER_PORT}`);
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
}

async function showAllStatus(): Promise<void> {
  const branches = listBranches();
  for (const branch of branches) {
    await showBranchStatus(branch);
    emptyLine();
  }
}
