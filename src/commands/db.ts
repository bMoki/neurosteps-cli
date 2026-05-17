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
import { WORKTREES_DIR } from "../lib/config";
import { error } from "../lib/logger";
import { execChecked } from "../lib/shell";
import { resolveDatabaseApp, ensureDatabaseAppConfigured } from "../lib/apps";

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
        .action(clearDbAction),
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
        .option("--force", "pula confirmação")
        .action((branch, name, opts) => restoreAction(branch, name, opts.force)),
    )
    .addCommand(
      new Command("snapshots")
        .description("Lista snapshots do banco")
        .argument("[branch]", "nome da branch")
        .action(listSnapshotsAction),
    )
    .addCommand(
      new Command("rm-snapshot")
        .description("Remove um snapshot")
        .argument("<branch>", "nome da branch")
        .argument("<name>", "nome do snapshot")
        .option("--force", "pula confirmação")
        .action((branch, name, opts) => rmSnapshotAction(branch, name, opts.force)),
    )
    .addCommand(
      new Command("open")
        .description("Abre o banco da branch no app de banco configurado")
        .argument("<branch>", "nome da branch")
        .option("--app <name>", "nome do app de banco para usar")
        .action(async (branch, opts) => {
          const wtDir = `${WORKTREES_DIR}/${branch}`;
          const file = Bun.file(wtDir);
          if (!(await file.exists())) {
            error(`Branch não encontrada: ${branch}`);
            process.exit(1);
          }

          let appKey: string;
          if (opts.app) {
            appKey = opts.app;
          } else {
            appKey = await ensureDatabaseAppConfigured();
          }

          const appPath = await resolveDatabaseApp().then(() => {
            // resolveDatabaseApp retorna key, precisamos do path
            // vamos abrir via nome do app no macOS
            const displayNames: Record<string, string> = {
              datagrip: "DataGrip",
              tableplus: "TablePlus",
              dbeaver: "DBeaver",
            };
            return displayNames[appKey] || appKey;
          });

          await execChecked(["open", "-a", appPath, wtDir], { silent: true }, `abrir banco no ${appPath} pelo macOS`);
        }),
    );

  return cmd;
}
