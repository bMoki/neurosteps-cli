import { Command } from "commander";
import { dbOnlyAction } from "../actions/db-only";
import { clearDbAction } from "../actions/clear-db";
import { dbPortAction, logsAction } from "../actions/simple";
import {
  snapshotAction,
  restoreAction,
  listSnapshotsAction,
  rmSnapshotAction,
} from "../actions/snapshot";
import { openDbAction } from "../actions/open-db";

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
        .action(snapshotAction),
    )
    .addCommand(
      new Command("restore")
        .description("Restaura banco a partir de snapshot")
        .argument("<branch>", "nome da branch")
        .argument("<name>", "nome do snapshot")
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
