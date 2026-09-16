import type { Ora } from "ora";
import type { NsContext, NsProgressEvent, NsQuestion } from "../core";
import { applyWhenUnavailable } from "../core";
import { isNoInputEnabled } from "./cli";
import { colors } from "./logger";
import { confirm } from "./prompt";

interface TerminalContextDeps {
  confirm: typeof confirm;
  canPrompt: () => boolean;
}

/**
 * Adapter de terminal: progresso vira texto de spinner, pergunta vira prompt.
 * Vive fora de `src/core/` porque conhece ora, inquirer e as flags globais do CLI.
 */
export function createTerminalContext(
  spinner: Ora,
  deps: Partial<TerminalContextDeps> = {},
): NsContext {
  const confirmFn = deps.confirm ?? confirm;
  const canPrompt = deps.canPrompt ?? isInteractiveInput;

  return {
    emit(event: NsProgressEvent): void {
      spinner.text = colors.info(formatLabel(event));
    },

    async ask(question: NsQuestion): Promise<boolean> {
      if (!canPrompt()) {
        return applyWhenUnavailable(question);
      }

      // O prompt e o spinner disputam o mesmo terminal: pausa enquanto pergunta.
      const wasSpinning = spinner.isSpinning;
      if (wasSpinning) spinner.stop();
      try {
        return await confirmFn(question.message, {}, { default: question.default });
      } finally {
        if (wasSpinning) spinner.start();
      }
    },
  };
}

function isInteractiveInput(): boolean {
  return !isNoInputEnabled() && Boolean(process.stdin.isTTY);
}

function formatLabel(event: NsProgressEvent): string {
  if (event.index === undefined || event.total === undefined) {
    return event.label;
  }
  return `[${event.index}/${event.total}] ${event.label}`;
}
