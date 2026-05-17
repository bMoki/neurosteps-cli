import { existsSync, statSync } from "fs";

function isBunFileMocked(): boolean {
  return Boolean((Bun.file as unknown as { mock?: unknown }).mock);
}

export function pathExists(path: string): boolean {
  try {
    const exists = Bun.file(path).exists() as unknown;
    if (typeof exists === "boolean") {
      return exists;
    }

    return isBunFileMocked() ? false : existsSync(path);
  } catch {
    return false;
  }
}

export async function pathExistsAsync(path: string): Promise<boolean> {
  try {
    const exists = await Bun.file(path).exists();
    return exists || (!isBunFileMocked() && existsSync(path));
  } catch {
    return false;
  }
}

export function dirExists(path: string): boolean {
  try {
    const exists = Bun.file(path).exists() as unknown;
    if (typeof exists === "boolean") {
      return exists;
    }

    return isBunFileMocked() ? false : statSync(path).isDirectory();
  } catch {
    return false;
  }
}
