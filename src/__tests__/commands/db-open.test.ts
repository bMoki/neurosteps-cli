import { describe, expect, mock, test } from "bun:test";
import { openDbAction } from "../../commands/db";

describe("openDbAction", () => {
  const run = mock((input: { branch: string; app?: string }) => Promise.resolve({ branch: input.branch, app: "DataGrip" }));

  test("sem --app pergunta qual app usar e abre com ele", async () => {
    const chooseApp = mock(() => Promise.resolve("datagrip"));

    await openDbAction("feat-123", undefined, { chooseApp, run });

    expect(chooseApp).toHaveBeenCalled();
    expect(run.mock.calls.at(-1)![0]).toEqual({ branch: "feat-123", app: "datagrip" });
  });

  test("--app pula a pergunta", async () => {
    const chooseApp = mock(() => Promise.resolve("datagrip"));

    await openDbAction("feat-123", "tableplus", { chooseApp, run });

    expect(chooseApp).not.toHaveBeenCalled();
    expect(run.mock.calls.at(-1)![0]).toEqual({ branch: "feat-123", app: "tableplus" });
  });
});
