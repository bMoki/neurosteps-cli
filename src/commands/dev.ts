import { Command } from "commander";
import { startAction } from "../actions/start";

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
