import { commandErrorMessage, execChecked, execSync, type ShellResult } from "./shell";

export async function branchExistsOnOrigin(
  repo: string,
  branch: string,
): Promise<boolean> {
  const result = await execChecked(
    ["git", "-C", repo, "ls-remote", "--heads", "origin", branch],
    { silent: true },
    `verificar branch remota ${branch}`,
  );
  return result.stdout.trim().length > 0;
}

export async function createLocalBranch(
  repo: string,
  branch: string,
  base: string,
): Promise<void> {
  await execChecked(
    ["git", "-C", repo, "branch", branch, base],
    { silent: true },
    `criar branch ${branch}`,
  );
}

export async function createTrackingBranch(
  repo: string,
  branch: string,
): Promise<void> {
  await execChecked(
    ["git", "-C", repo, "branch", "--track", branch, `origin/${branch}`],
    { silent: true },
    `criar branch rastreando origin/${branch}`,
  );
}

export async function createWorktree(
  repo: string,
  path: string,
  branch: string,
): Promise<void> {
  await execChecked(
    ["git", "-C", repo, "worktree", "add", path, branch],
    { silent: true },
    `criar worktree ${path}`,
  );
}

export async function removeWorktree(
  repo: string,
  path: string,
  { force = false }: { force?: boolean } = {},
): Promise<void> {
  const args = ["git", "-C", repo, "worktree", "remove"];
  if (force) args.push("--force");
  args.push(path);

  await execChecked(
    args,
    { silent: true },
    `remover worktree ${path}`,
  );
}

export async function deleteBranch(repo: string, branch: string): Promise<void> {
  await execChecked(
    ["git", "-C", repo, "branch", "-D", branch],
    { silent: true },
    `remover branch local ${branch}`,
  );
}

export async function fetchOrigin(repo: string): Promise<void> {
  await execChecked(
    ["git", "-C", repo, "fetch", "origin", "--quiet"],
    { silent: true },
    "buscar atualizações do origin",
  );
}

export function localBranchExists(repo: string, branch: string): boolean {
  let result: ShellResult;
  try {
    result = execSync(
      ["git", "-C", repo, "show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
      { silent: true },
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Falha ao verificar branch local ${branch}: ${reason}`);
  }
  if (result.exitCode === 0) return true;
  if (result.exitCode === 1) return false;
  throw new Error(commandErrorMessage(`verificar branch local ${branch}`, result));
}
