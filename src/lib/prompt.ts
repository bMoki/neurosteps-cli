import { confirm as inqConfirm } from "@inquirer/prompts";
import { isNoInputEnabled } from "./cli";

interface ConfirmDeps {
  confirm: typeof inqConfirm;
}

export async function confirm(
  message: string,
  deps: Partial<ConfirmDeps> = {},
): Promise<boolean> {
  if (!deps.confirm) {
    assertInteractiveInput("pedir confirmação");
  }
  const confirmFn = deps.confirm ?? inqConfirm;
  return confirmFn({ message, default: false });
}

export function assertInteractiveInput(action: string): void {
  if (isNoInputEnabled()) {
    throw new Error(`Não é possível ${action}: prompts foram desativados com --no-input.`);
  }
  if (!process.stdin.isTTY) {
    throw new Error(`Não é possível ${action}: stdin não é um terminal interativo.`);
  }
}
