import { Command } from "commander";
import { dbOnlyAction } from "../actions/db-only";
import { clearDbAction } from "../actions/clear-db";
import { dbPortAction, logsAction } from "../actions/simple";
import {
  type SnapshotDeps,
  createSilentContext,
  isNsError,
  runDbOpen,
  runDbRestore,
  runDbRestorePreview,
  runDbRmSnapshot,
  runDbSnapshot,
  runDbSnapshotFind,
  runDbSnapshots,
  snapshotFile,
} from "../core";
import { ensureDatabaseAppConfigured } from "../lib/apps";
import { detail, emptyLine, heading, hint, info, ok, spinner, warn } from "../lib/logger";
import { confirm as defaultConfirm } from "../lib/prompt";
import { createTerminalContext, stopSpinnerOnError } from "../lib/terminal-context";

export function dbCommand(): Command {
  const cmd = new Command("db")
    .description("Gerencia banco de dados da branch")
    .addCommand(
      new Command("start")
        .description("Inicia apenas o container PostgreSQL")
        .argument("<branch>", "nome da branch")
        .action(dbOnlyAction),
    )
    .addCommand(
      new Command("reset")
        .description("Reseta o volume do banco e reseeda do original")
        .argument("<branch>", "nome da branch")
        .option("-n, --dry-run", "simula a operação sem executar")
        .action((branch, opts) => clearDbAction(branch, opts.dryRun)),
    )
    .addCommand(
      new Command("port")
        .description("Mostra a porta do banco da branch")
        .argument("<branch>", "nome da branch")
        .action(dbPortAction),
    )
    .addCommand(
      new Command("logs")
        .description("Mostra logs do banco da branch")
        .argument("<branch>", "nome da branch")
        .action(logsAction),
    )
    .addCommand(
      new Command("snapshot")
        .description("Salva o estado atual do banco")
        .argument("<branch>", "nome da branch")
        .argument("[name]", "nome do snapshot")
        .option("-f, --force", "substitui sem perguntar um snapshot com o mesmo nome")
        .action((branch, name, opts) => snapshotAction(branch, name, opts.force)),
    )
    .addCommand(
      new Command("restore")
        .description("Restaura banco a partir de snapshot (suporta refs cross-branch: origem:nome)")
        .argument("<branch>", "nome da branch alvo")
        .argument("<ref>", "ref do snapshot: <nome> ou <origem>:<nome>")
        .option("-f, --force", "pula confirmação")
        .option("-n, --dry-run", "simula a operação sem executar")
        .action((branch, name, opts) => restoreAction(branch, name, opts.force, {}, opts.dryRun)),
    )
    .addCommand(
      new Command("snapshots")
        .description("Lista snapshots do banco")
        .argument("[branch]", "nome da branch")
        .option("--json", "emite saída em JSON (stdout)")
        .action((branch, opts) => listSnapshotsAction(branch, {}, opts.json)),
    )
    .addCommand(
      new Command("rm-snapshot")
        .description("Remove um snapshot")
        .argument("<branch>", "nome da branch")
        .argument("<name>", "nome do snapshot")
        .option("-f, --force", "pula confirmação")
        .option("-n, --dry-run", "simula a operação sem executar")
        .action((branch, name, opts) => rmSnapshotAction(branch, name, opts.force, {}, opts.dryRun)),
    )
    .addCommand(
      new Command("open")
        .description("Abre o banco da branch no app de banco configurado")
        .argument("<branch>", "nome da branch")
        .option("--app <name>", "nome do app de banco para usar")
        .action((branch, opts) => openDbAction(branch, opts.app)),
    );

  return cmd;
}

/** No terminal, sem app configurado, pergunta qual usar antes de abrir. */
export async function openDbAction(
  branch: string,
  appKey?: string,
  deps: { chooseApp: () => Promise<string>; run: typeof runDbOpen } = { chooseApp: ensureDatabaseAppConfigured, run: runDbOpen },
): Promise<void> {
  const { app } = await deps.run({ branch, app: appKey ?? (await deps.chooseApp()) }, createSilentContext());
  ok(`Banco de ${branch} aberto no ${app}`);
}

export interface SnapshotActionDeps extends SnapshotDeps {
  confirm: typeof defaultConfirm;
}

export async function snapshotAction(branch: string, name?: string, force = false, deps: Partial<SnapshotActionDeps> = {}): Promise<void> {
  const { confirm = defaultConfirm, ...snapshotDeps } = deps;
  const existing = name && name !== "latest" ? await runDbSnapshotFind({ branch, name }, createSilentContext(), snapshotDeps).catch(ignoreNotFound) : null;
  if (existing && !force && !(await confirm(`Já existe um snapshot '${existing.name}' em ${branch}. Substituir?`))) {
    warn("Operação cancelada.");
    return;
  }

  const s = spinner(`Criando snapshot de ${branch}...`).start();
  const snapshot = await runDbSnapshot({ branch, name, replace: existing !== null }, createTerminalContext(s), snapshotDeps)
    .catch(stopSpinnerOnError(s));
  s.succeed(`Snapshot '${snapshot.name}' criado para ${branch}`);
  emptyLine();
  detail("Volume", snapshot.volume);
  detail("Arquivo", snapshotFile(branch, snapshot.name));
}

export async function restoreAction(
  branch: string,
  ref: string,
  force: boolean,
  deps: Partial<SnapshotActionDeps> = {},
  dryRun = false,
): Promise<void> {
  const { confirm = defaultConfirm, ...snapshotDeps } = deps;
  const { volume, snapshot } = await runDbRestorePreview({ branch, ref }, createSilentContext(), snapshotDeps);
  const isCross = snapshot.branch !== branch;
  const displayRef = isCross ? snapshot.ref : snapshot.name;

  if (dryRun) {
    warn(`[dry-run] Seria executado em '${branch}':`);
    hint(`  parar PostgreSQL`);
    hint(`  substituir volume ${volume} pelo snapshot '${displayRef}'`);
    hint(`  origem: ${snapshot.volume}`);
    return;
  }

  if (!force) {
    const message = isCross
      ? `Restaurar '${displayRef}' (origem: ${snapshot.branch}) em '${branch}'? Isso substituirá o banco atual.`
      : `Restaurar snapshot '${snapshot.name}' em ${branch}? Isso substituirá o banco atual.`;
    if (!(await confirm(message))) {
      warn("Operação cancelada.");
      return;
    }
  }

  const s = spinner(`Restaurando snapshot em ${branch}...`).start();
  await runDbRestore({ branch, ref: snapshot.ref }, createTerminalContext(s), snapshotDeps).catch(stopSpinnerOnError(s));
  s.succeed(`Snapshot '${displayRef}' restaurado em ${branch}`);
  emptyLine();
  detail("Snapshot", displayRef);
  detail("Volume origem", snapshot.volume);
  detail("Volume destino", volume);
}

export async function listSnapshotsAction(branch?: string, deps: Partial<SnapshotDeps> = {}, asJson = false): Promise<void> {
  const groups = await runDbSnapshots({ branch }, createSilentContext(), deps);

  if (asJson) {
    const toJson = (snapshots: typeof groups[number]["snapshots"]) =>
      snapshots.map(({ name, ref, createdAt, volume }) => ({ name, ref, created_at: createdAt, volume }));
    const result = branch
      ? toJson(groups[0]?.snapshots ?? [])
      : Object.fromEntries(groups.map((group) => [group.branch, toJson(group.snapshots)]));
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return;
  }

  const found = groups.filter(({ snapshots }) => snapshots.length > 0);
  if (found.length === 0) {
    info(branch ? `Nenhum snapshot encontrado para ${branch}.` : "Nenhum snapshot encontrado.");
    return;
  }
  for (const group of found) {
    heading(group.orphan ? `Órfãos: ${group.branch} (branch removida)` : `Snapshots: ${group.branch}`);
    for (const snapshot of group.snapshots) {
      detail(snapshot.ref, `${snapshot.createdAt} · ${snapshot.volume}`);
    }
    emptyLine();
  }
}

function ignoreNotFound(error: unknown): null {
  if (isNsError(error) && error.category === "nao-encontrado") return null;
  throw error;
}

export async function rmSnapshotAction(
  branch: string,
  name: string,
  force: boolean,
  deps: Partial<SnapshotActionDeps> = {},
  dryRun = false,
): Promise<void> {
  const { confirm = defaultConfirm, ...snapshotDeps } = deps;
  const snapshot = await runDbSnapshotFind({ branch, name }, createSilentContext(), snapshotDeps);

  if (dryRun) {
    warn(`[dry-run] Seria removido o snapshot '${snapshot.name}' de '${branch}':`);
    hint(`  volume: ${snapshot.volume}`);
    hint(`  arquivo: ${snapshotFile(branch, snapshot.name)}`);
    return;
  }

  if (!force && !(await confirm(`Remover snapshot '${snapshot.name}' de ${branch}?`))) {
    warn("Operação cancelada.");
    return;
  }

  await runDbRmSnapshot({ branch, name: snapshot.name }, createSilentContext(), snapshotDeps);
  info(`Snapshot '${snapshot.name}' removido de ${branch}.`);
}
