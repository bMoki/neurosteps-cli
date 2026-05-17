import { describe, test, expect, mock } from "bun:test";
import { info, ok, warn, error, spinner, heading } from "../../lib/logger";

describe("logger", () => {
  test("info prints info message", () => {
    const consoleSpy = mock(() => {});
    const originalLog = console.log;
    console.log = consoleSpy;
    info("test message");
    expect(consoleSpy).toHaveBeenCalled();
    console.log = originalLog;
  });

  test("ok prints ok message", () => {
    const consoleSpy = mock(() => {});
    const originalLog = console.log;
    console.log = consoleSpy;
    ok("test message");
    expect(consoleSpy).toHaveBeenCalled();
    console.log = originalLog;
  });

  test("warn prints warn message", () => {
    const consoleSpy = mock(() => {});
    const originalLog = console.log;
    console.log = consoleSpy;
    warn("test message");
    expect(consoleSpy).toHaveBeenCalled();
    console.log = originalLog;
  });

  test("error prints error message", () => {
    const consoleSpy = mock(() => {});
    const originalError = console.error;
    console.error = consoleSpy;
    error("test message");
    expect(consoleSpy).toHaveBeenCalled();
    console.error = originalError;
  });

  test("spinner creates spinner", () => {
    const s = spinner("test");
    expect(s).toBeDefined();
    s.start();
    s.stop();
  });

  test("heading prints heading", () => {
    const consoleSpy = mock(() => {});
    const originalLog = console.log;
    console.log = consoleSpy;
    heading("Test Heading");
    expect(consoleSpy).toHaveBeenCalled();
    console.log = originalLog;
  });

});
