import { describe, test, expect, mock } from "bun:test";
import { prepareAction } from "../../actions/prepare";
import { createMockWorkspaceEnv } from "../setup";

class ProcessExit extends Error {}

describe("prepareAction", () => {
  const createMocks = () => ({
    readEnv: mock(() => Promise.resolve(createMockWorkspaceEnv())),
    composeUp: mock(() => Promise.resolve()),
    waitPg: mock(() => Promise.resolve()),
    regAlias: mock(() => Promise.resolve()),
    proxyRunning: mock(() => false),
    proxyStart: mock(() => Promise.resolve()),
  });

  test("prepares branch with all services", async () => {
    const mocks = createMocks();
    await prepareAction("feat-123", mocks);

    expect(mocks.readEnv).toHaveBeenCalledWith("feat-123");
    expect(mocks.composeUp).toHaveBeenCalled();
    expect(mocks.waitPg).toHaveBeenCalledWith("myapp-psql-feat-123");
    expect(mocks.proxyStart).toHaveBeenCalled();
    expect(mocks.regAlias).toHaveBeenCalledWith("feat-123.api.neurosteps", 8084);
    expect(mocks.regAlias).toHaveBeenCalledWith("feat-123.web.neurosteps", 3015);
    expect(mocks.regAlias).toHaveBeenCalledWith("feat-123.manager.neurosteps", 3021);
  });

  test("does not start proxy if already running", async () => {
    const mocks = createMocks();
    mocks.proxyRunning = mock(() => true);
    await prepareAction("feat-123", mocks);
    expect(mocks.proxyStart).not.toHaveBeenCalled();
  });

  test("exits when branch not found", async () => {
    const mocks = createMocks();
    mocks.readEnv = mock(() => Promise.resolve(null as any));
    
    const originalExit = process.exit;
    process.exit = ((code: number) => { throw new ProcessExit(String(code)); }) as any;
    
    try {
      await prepareAction("NONEXISTENT", mocks);
      expect(false).toBe(true); // Should not reach here
    } catch (e) {
      expect(e).toBeInstanceOf(ProcessExit);
    }
    
    process.exit = originalExit;
  });
});
