import { confirm as inqConfirm } from "@inquirer/prompts";

interface ConfirmDeps {
  confirm: typeof inqConfirm;
}

export async function confirm(
  message: string,
  deps: Partial<ConfirmDeps> = {},
): Promise<boolean> {
  const confirmFn = deps.confirm ?? inqConfirm;
  return confirmFn({ message, default: false });
}
