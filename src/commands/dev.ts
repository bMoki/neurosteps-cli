import { Command } from "commander";
import { resolveBackendDir } from "../lib/config";
import { exec, formatShellCommand, spawnTerminal } from "../lib/shell";
import { attachCommand, hasTmux, startService } from "../lib/services";
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
  runTmux?: typeof exec;
  aiFlag?: string;
  noManager?: boolean;
  noReportServer?: boolean;
}

export async function startAction(branch: string, deps: StartActionDeps = {}): Promise<void> {
  const {
    spawnTerm = spawnTerminal,
    runTmux = exec,
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

  const services = result.services;
  const tmux = await hasTmux(runTmux);
  const alreadyRunning: ServicePlan[] = [];
  if (tmux) {
    s.text = "Subindo sessões tmux...";
    const up: ServicePlan[] = [];
    try {
      for (const service of services) {
        if (await startService(service, runTmux) === "running") alreadyRunning.push(service);
        up.push(service);
      }
    } catch (error) {
      s.fail(`Falha ao subir os serviços de ${branch}`);
      if (up.length > 0) {
        hint(`Já estão rodando: ${up.map((service) => service.label).join(", ")}. Para parar: ns stop ${branch}`);
      }
      throw error;
    }
  } else {
    s.stop();
    warn("tmux não encontrado: os serviços vão rodar dentro das janelas e param quando a janela fechar.");
    hint("Instale com: brew install tmux");
    s.start();
  }

  s.text = "Abrindo terminais...";
  const openWindow = tmux
    ? (service: ServicePlan) => spawnTerm(service.cwd, {}, attachCommand(service.session))
    : (service: ServicePlan) => spawnTerm(service.cwd, service.env, service.command);
  const terminalResult = await openServiceTerminals(services, openWindow);

  if (terminalResult.error) {
    s.stop();
    warn(`Terminal.app não abriu automaticamente para ${branch}`);
  } else {
    s.succeed(`Serviços iniciados para ${branch}`);
  }

  for (const service of alreadyRunning) {
    detail(service.label, "já estava rodando");
  }

  emptyLine();
  printUrls(result);

  if (terminalResult.error) {
    emptyLine();
    detail("Terminais abertos", terminalResult.opened);
    hint(`Motivo: ${summarizeTerminalError(terminalResult.error)}`);
    if (tmux) {
      hint("Os serviços estão rodando em sessões tmux. Para ver cada um:");
      emptyLine();
      for (const service of services) {
        detail(service.label, attachCommand(service.session));
      }
    } else {
      hint("DB e aliases Portless foram preparados. Para subir os serviços, rode manualmente:");
      emptyLine();
      for (const service of services) {
        detail(service.label, formatShellCommand(service.cwd, service.env, service.command));
      }
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
  if (tmux) hint(`Fechar a janela não para o serviço. Para parar: ns stop ${branch}`);
  hint(`Próximo passo: ns status ${branch}  # ver status dos serviços`);
}

async function openServiceTerminals(
  services: ServicePlan[],
  openWindow: (service: ServicePlan) => Promise<void>,
): Promise<TerminalOpenResult> {
  let opened = 0;

  for (const service of services) {
    try {
      await openWindow(service);
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
