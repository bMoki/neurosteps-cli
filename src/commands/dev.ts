import { Command } from "commander";
import { resolveBackendDir } from "../lib/config";
import { formatShellCommand, spawnTerminal } from "../lib/shell";
import { detail, emptyLine, hint, spinner, warn } from "../lib/logger";
import { openAiApp } from "../lib/apps";
import type { ServicePlan } from "../core";
import { type PrepareActionDeps, printUrls, runPrepareInTerminal } from "./prepare";

export function startCommand(): Command {
  return new Command("start")
    .description("Inicia DB + backend + frontend no Terminal")
    .argument("<branch>", "nome da branch")
    .option("--claude", "abre Claude Desktop")
    .option("--opencode", "abre OpenCode")
    .option("--codex", "abre Codex (OpenAI CLI)")
    .option("--no-manager", "não inicia o repo manager")
    .option("--no-report-server", "não inicia o repo report-server")
    .action(async (branch, opts) => {
      const aiFlag = opts.claude ? "claude" : opts.opencode ? "opencode" : opts.codex ? "codex" : undefined;
      await startAction(branch, { aiFlag, noManager: opts.manager === false, noReportServer: opts.reportServer === false });
    });
}

interface TerminalOpenResult {
  opened: number;
  error?: unknown;
}

export interface StartActionDeps extends PrepareActionDeps {
  spawnTerm?: typeof spawnTerminal;
  aiFlag?: string;
  noManager?: boolean;
  noReportServer?: boolean;
}

export async function startAction(branch: string, deps: StartActionDeps = {}): Promise<void> {
  const {
    spawnTerm = spawnTerminal,
    aiFlag,
    noManager = false,
    noReportServer = false,
    ...prepareDeps
  } = deps;
  const s = spinner(`Iniciando ${branch}...`).start();

  const result = await runPrepareInTerminal(s, {
    branch,
    withManager: !noManager,
    withReportServer: !noReportServer,
    installMissingDeps: "ask",
  }, prepareDeps);

  s.text = "Abrindo terminais...";
  const services = result.services;
  const terminalResult = await openServiceTerminals(services, spawnTerm);

  if (terminalResult.error) {
    s.stop();
    warn(`Terminal.app não abriu automaticamente para ${branch}`);
  } else {
    s.succeed(`Serviços iniciados para ${branch}`);
  }

  emptyLine();
  printUrls(result);

  if (terminalResult.error) {
    emptyLine();
    detail("Terminais abertos", terminalResult.opened);
    hint(`Motivo: ${summarizeTerminalError(terminalResult.error)}`);
    hint("DB e aliases Portless foram preparados. Para subir os serviços, rode manualmente:");
    emptyLine();
    for (const service of services) {
      detail(service.label, formatShellCommand(service.cwd, service.env, service.command));
    }
  }

  if (aiFlag) {
    try {
      s.text = `Abrindo ${aiFlag}...`;
      await openAiApp(aiFlag, resolveBackendDir(branch));
      detail("AI", aiFlag + " aberto");
    } catch (error) {
      warn(`Não foi possível abrir ${aiFlag}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  emptyLine();
  hint(`Próximo passo: ns status ${branch}  # ver status dos serviços`);
}

async function openServiceTerminals(
  services: ServicePlan[],
  spawnTerm: typeof spawnTerminal,
): Promise<TerminalOpenResult> {
  let opened = 0;

  for (const service of services) {
    try {
      await spawnTerm(service.cwd, service.env, service.command);
      opened += 1;
    } catch (error) {
      return { opened, error };
    }
  }

  return { opened };
}

function summarizeTerminalError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const firstLine = message.split("\n")[0]?.trim() || "erro desconhecido";
  return firstLine.replace(/: osascript .*/, "");
}
