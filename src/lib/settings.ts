import { homedir } from "os";
import { join } from "path";
import { mkdirSync } from "fs";

export const NS_CONFIG_DIR = join(homedir(), ".config", "ns");
export const NS_SETTINGS_FILE = join(NS_CONFIG_DIR, "settings.json");
export const NS_ENV_FILE = join(NS_CONFIG_DIR, "env.json");

export interface NsSettings {
  defaultIde?: string;
  databaseApp?: string;
  apps?: Record<string, string>;
}

export async function readSettings(): Promise<NsSettings> {
  try {
    const file = Bun.file(NS_SETTINGS_FILE);
    if (await file.exists()) {
      const content = await file.text();
      return JSON.parse(content) as NsSettings;
    }
  } catch {
    // ignore parse errors
  }
  return {};
}

export async function writeSettings(settings: NsSettings): Promise<void> {
  mkdirSync(NS_CONFIG_DIR, { recursive: true });
  await Bun.write(NS_SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

export async function getSetting(key: keyof NsSettings): Promise<string | Record<string, string> | undefined> {
  const settings = await readSettings();
  return settings[key];
}

export async function setSetting(key: keyof NsSettings, value: string | Record<string, string>): Promise<void> {
  const settings = await readSettings();
  (settings as any)[key] = value;
  await writeSettings(settings);
}

// ─── Env file persistence ───

export async function readEnvFile(): Promise<Record<string, string>> {
  try {
    const file = Bun.file(NS_ENV_FILE);
    if (await file.exists()) {
      const content = await file.text();
      const parsed = JSON.parse(content);
      // Flatten nested objects to string values for env compatibility
      const result: Record<string, string> = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (value !== null && value !== undefined) {
          result[key] = String(value);
        }
      }
      return result;
    }
  } catch {
    // ignore parse errors
  }
  return {};
}

export async function writeEnvFile(vars: Record<string, string | number>): Promise<void> {
  mkdirSync(NS_CONFIG_DIR, { recursive: true });
  await Bun.write(NS_ENV_FILE, JSON.stringify(vars, null, 2));
}
