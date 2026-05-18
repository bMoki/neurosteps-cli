import { Command } from "commander";
import { readSettings, getSetting, setSetting, type NsSettings, readEnvFile, NS_ENV_FILE } from "../lib/settings";
import { detectInstalledApps } from "../lib/apps";
import { ok, error, detail } from "../lib/logger";
import { initAction } from "../actions/init";

export function configCommand(): Command {
  const cmd = new Command("config")
    .description("Gerencia configurações do CLI");

  cmd
    .addCommand(
      new Command("get")
        .description("Lê uma configuração")
        .argument("<key>", "chave da configuração")
        .action(async (key) => {
          const value = await getSetting(key as keyof NsSettings);
          if (value === undefined) {
            error(`Config '${key}' não definida`);
            process.exit(1);
          }
          if (typeof value === "string") {
            console.log(value);
          } else {
            console.log(JSON.stringify(value, null, 2));
          }
        }),
    )
    .addCommand(
      new Command("set")
        .description("Define uma configuração")
        .argument("<key>", "chave da configuração")
        .argument("<value>", "valor da configuração")
        .action(async (key, value) => {
          let parsed: string | Record<string, string> = value;
          if (key === "apps") {
            try {
              parsed = JSON.parse(value);
            } catch {
              error("Valor inválido para 'apps'. Use JSON.");
              process.exit(1);
            }
          }
          await setSetting(key as keyof NsSettings, parsed);
          ok(`Config '${key}' = ${value}`);
        }),
    )
    .addCommand(
      new Command("env")
        .description("Visualiza ou reconfigura env.json")
        .option("--path", "mostra o caminho do arquivo")
        .option("--edit", "abre reconfiguração interativa")
        .action(async (opts) => {
          if (opts.path) {
            console.log(NS_ENV_FILE);
            return;
          }

          if (opts.edit) {
            await initAction({ reconfig: true });
            return;
          }

          const envConfig = await readEnvFile();
          if (Object.keys(envConfig).length === 0) {
            console.log("Nenhuma configuração de ambiente salva.");
            console.log("Rode 'ns init' para configurar.");
            return;
          }

          console.log(`Arquivo: ${NS_ENV_FILE}`);
          for (const [key, value] of Object.entries(envConfig)) {
            detail(key, value);
          }
        }),
    )
    .addCommand(
      new Command("list")
        .description("Lista todas as configurações")
        .option("--json", "emite saída em JSON (stdout)")
        .action(async (opts) => {
          const settings = await readSettings();
          if (opts.json) {
            process.stdout.write(JSON.stringify(settings, null, 2) + "\n");
            return;
          }
          if (Object.keys(settings).length === 0) {
            console.log("Nenhuma configuração definida.");
            return;
          }
          for (const [key, value] of Object.entries(settings)) {
            if (typeof value === "string") {
              detail(key, value);
            } else {
              detail(key, JSON.stringify(value));
            }
          }
        }),
    )
    .addCommand(
      new Command("detect-apps")
        .description("Detecta apps instalados e mostra opções")
        .action(async () => {
          const detected = detectInstalledApps();
          if (detected.length === 0) {
            console.log("Nenhum app detectado.");
            return;
          }
          console.log("Apps detectados:");
          for (const app of detected) {
            detail(app.key, app.name);
            detail("  path", app.path);
          }
        }),
    );

  return cmd;
}
