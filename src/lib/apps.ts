import { execSync } from "./shell";
import { getSetting, readSettings, writeSettings } from "./settings";
import { select, input } from "@inquirer/prompts";

export interface DetectedApp {
  key: string;
  name: string;
  path: string;
}

const APP_REGISTRY: Record<string, string[]> = {
  vscode: ["Visual Studio Code.app", "Visual Studio Code - Insiders.app"],
  intellij: ["IntelliJ IDEA.app", "IntelliJ IDEA CE.app"],
  datagrip: ["DataGrip.app"],
  cursor: ["Cursor.app"],
  fleet: ["Fleet.app"],
  tableplus: ["TablePlus.app", "TablePlus Setapp.app"],
  dbeaver: ["DBeaver.app", "DBeaverUltimate.app"],
  webstorm: ["WebStorm.app"],
};

export function appDisplayName(key: string): string {
  const names: Record<string, string> = {
    vscode: "Visual Studio Code",
    intellij: "IntelliJ IDEA",
    datagrip: "DataGrip",
    cursor: "Cursor",
    fleet: "Fleet",
    tableplus: "TablePlus",
    dbeaver: "DBeaver",
    webstorm: "WebStorm",
  };
  return names[key] || key;
}

export function detectInstalledApps(): DetectedApp[] {
  const found: DetectedApp[] = [];
  for (const [key, bundleIds] of Object.entries(APP_REGISTRY)) {
    for (const bundle of bundleIds) {
      const path = `/Applications/${bundle}`;
      try {
        const result = execSync(["test", "-d", path], { silent: true });
        if (result.exitCode === 0) {
          found.push({ key, name: appDisplayName(key), path });
          break;
        }
      } catch {
        // ignore
      }
      // Try Setapp path
      const setappPath = `/Applications/Setapp/${bundle}`;
      try {
        const result = execSync(["test", "-d", setappPath], { silent: true });
        if (result.exitCode === 0) {
          found.push({ key, name: `${appDisplayName(key)} (Setapp)`, path: setappPath });
          break;
        }
      } catch {
        // ignore
      }
    }
  }
  return found;
}

export async function resolveAppPath(key: string): Promise<string | null> {
  const settings = await readSettings();
  if (settings.apps?.[key]) {
    return settings.apps[key];
  }
  const registry = APP_REGISTRY[key];
  if (registry) {
    for (const bundle of registry) {
      for (const base of ["/Applications", "/Applications/Setapp"]) {
        const path = `${base}/${bundle}`;
        try {
          const result = execSync(["test", "-d", path], { silent: true });
          if (result.exitCode === 0) return path;
        } catch {
          // ignore
        }
      }
    }
  }
  return null;
}

export async function resolveDefaultIde(): Promise<string> {
  const configured = await getSetting("defaultIde");
  if (configured && typeof configured === "string") {
    const path = await resolveAppPath(configured);
    if (path) return configured;
  }
  const detected = detectInstalledApps();
  const vscode = detected.find((a) => a.key === "vscode");
  if (vscode) return "vscode";
  const firstDetected = detected[0];
  if (firstDetected) return firstDetected.key;
  return "vscode";
}

export async function resolveDatabaseApp(): Promise<string> {
  const configured = await getSetting("databaseApp");
  if (configured && typeof configured === "string") {
    const path = await resolveAppPath(configured);
    if (path) return configured;
  }
  const detected = detectInstalledApps();
  const dg = detected.find((a) => a.key === "datagrip");
  if (dg) return "datagrip";
  const firstDetected = detected[0];
  if (firstDetected) return firstDetected.key;
  return "datagrip";
}

export async function promptForApp(apps: DetectedApp[]): Promise<string> {
  const choices = apps.map((a) => ({ name: a.name, value: a.key }));
  choices.push({ name: "Outro (inserir manualmente)", value: "__manual__" });

  const selected = await select({
    message: "Qual app usar?",
    choices,
  });

  if (selected === "__manual__") {
    const manual = await input({ message: "Digite o nome do app (ex: DataGrip) ou caminho completo:" });
    return manual.trim();
  }

  return selected;
}

export async function ensureDefaultIdeConfigured(): Promise<string> {
  const current = await getSetting("defaultIde");
  if (current && typeof current === "string") {
    if (await resolveAppPath(current)) return current;
  }

  const detected = detectInstalledApps();
  if (detected.length === 0) {
    console.log("Nenhum IDE detectado automaticamente.");
    const manual = await input({ message: "Digite o nome do app IDE (ex: Visual Studio Code):" });
    const settings = await readSettings();
    settings.defaultIde = manual;
    await writeSettings(settings);
    return manual;
  }

  const chosen = await promptForApp(detected);
  const settings = await readSettings();
  const appPath = detected.find((a) => a.key === chosen)?.path || chosen;
  settings.defaultIde = chosen;
  if (!settings.apps) settings.apps = {};
  settings.apps[chosen] = appPath;
  await writeSettings(settings);
  return chosen;
}

export async function ensureDatabaseAppConfigured(): Promise<string> {
  const current = await getSetting("databaseApp");
  if (current && typeof current === "string") {
    if (await resolveAppPath(current)) return current;
  }

  const detected = detectInstalledApps();
  if (detected.length === 0) {
    console.log("Nenhum app de banco detectado automaticamente.");
    const manual = await input({ message: "Digite o nome do app (ex: DataGrip):" });
    const settings = await readSettings();
    settings.databaseApp = manual;
    await writeSettings(settings);
    return manual;
  }

  const chosen = await promptForApp(detected);
  const settings = await readSettings();
  const appPath = detected.find((a) => a.key === chosen)?.path || chosen;
  settings.databaseApp = chosen;
  if (!settings.apps) settings.apps = {};
  settings.apps[chosen] = appPath;
  await writeSettings(settings);
  return chosen;
}
