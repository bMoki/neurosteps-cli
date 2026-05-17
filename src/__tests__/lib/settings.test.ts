import { describe, test, expect, beforeEach } from "bun:test";
import { readSettings, writeSettings, getSetting, setSetting, NS_SETTINGS_FILE } from "../../lib/settings";

describe("settings", () => {
  beforeEach(async () => {
    try {
      await Bun.write(NS_SETTINGS_FILE, "{}");
    } catch {
      // ignore
    }
  });

  test("readSettings returns empty object when file missing", async () => {
    // Ensure file doesn't exist
    try { await Bun.file(NS_SETTINGS_FILE).delete(); } catch { /* ignore */ }
    const settings = await readSettings();
    expect(settings).toEqual({});
  });

  test("writeSettings and readSettings roundtrip", async () => {
    await writeSettings({ defaultIde: "vscode", databaseApp: "datagrip" });
    const settings = await readSettings();
    expect(settings.defaultIde).toBe("vscode");
    expect(settings.databaseApp).toBe("datagrip");
  });

  test("getSetting returns undefined for missing key", async () => {
    await writeSettings({});
    const value = await getSetting("defaultIde");
    expect(value).toBeUndefined();
  });

  test("setSetting writes value", async () => {
    await setSetting("defaultIde", "intellij");
    const value = await getSetting("defaultIde");
    expect(value).toBe("intellij");
  });
});
