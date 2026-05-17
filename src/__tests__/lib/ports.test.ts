import { describe, test, expect, mock } from "bun:test";
import { isPortAvailable, getNextPort, allocatePorts } from "../../lib/ports";

describe("ports", () => {
  test("isPortAvailable returns true when lsof fails", () => {
    const originalSpawnSync = Bun.spawnSync;
    Bun.spawnSync = mock(() => ({ exitCode: 1 })) as any;
    expect(isPortAvailable(8080)).toBe(true);
    Bun.spawnSync = originalSpawnSync;
  });

  test("isPortAvailable returns false when lsof succeeds", () => {
    const originalSpawnSync = Bun.spawnSync;
    Bun.spawnSync = mock(() => ({ exitCode: 0 })) as any;
    expect(isPortAvailable(8080)).toBe(false);
    Bun.spawnSync = originalSpawnSync;
  });

  test("getNextPort finds next available port", () => {
    const originalSpawnSync = Bun.spawnSync;
    let callCount = 0;
    Bun.spawnSync = mock(() => {
      callCount++;
      return { exitCode: callCount > 2 ? 1 : 0 };
    }) as any;
    expect(getNextPort(8080)).toBe(8082);
    Bun.spawnSync = originalSpawnSync;
  });

  test("allocatePorts returns all ports", () => {
    const originalSpawnSync = Bun.spawnSync;
    Bun.spawnSync = mock(() => ({ exitCode: 1 })) as any;
    
    const ports = allocatePorts();
    expect(ports.db).toBeGreaterThan(0);
    expect(ports.backend).toBeGreaterThan(0);
    expect(ports.backendDebug).toBeGreaterThan(0);
    expect(ports.frontend).toBeGreaterThan(0);
    expect(ports.manager).toBeUndefined();
    
    Bun.spawnSync = originalSpawnSync;
  });

  test("allocatePorts with manager includes manager port", () => {
    const originalSpawnSync = Bun.spawnSync;
    Bun.spawnSync = mock(() => ({ exitCode: 1 })) as any;
    
    const ports = allocatePorts(true);
    expect(ports.manager).toBeGreaterThan(0);
    
    Bun.spawnSync = originalSpawnSync;
  });
});
