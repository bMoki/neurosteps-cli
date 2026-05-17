import { describe, test, expect } from "bun:test";
import { appDisplayName, resolveAppPath } from "../../lib/apps";

describe("apps", () => {
  test("appDisplayName returns display name", () => {
    expect(appDisplayName("vscode")).toBe("Visual Studio Code");
    expect(appDisplayName("datagrip")).toBe("DataGrip");
    expect(appDisplayName("unknown")).toBe("unknown");
  });

  test("resolveAppPath returns null for unknown app", async () => {
    const path = await resolveAppPath("nonexistent-app-xyz");
    expect(path).toBeNull();
  });
});
