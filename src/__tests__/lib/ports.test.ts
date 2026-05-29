import { describe, test, expect, mock, spyOn } from "bun:test";
import { isPortAvailable, getNextPort, getAssignedPorts, allocatePorts } from "../../lib/ports";
import * as config from "../../lib/config";
import * as fs from "fs";

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

  test("getNextPort skips ports in reserved set", () => {
    const originalSpawnSync = Bun.spawnSync;
    Bun.spawnSync = mock(() => ({ exitCode: 1 })) as any;

    const reserved = new Set([8080, 8081, 8082]);
    expect(getNextPort(8080, reserved)).toBe(8083);

    Bun.spawnSync = originalSpawnSync;
  });

  test("getNextPort skips both OS-bound and reserved ports", () => {
    const originalSpawnSync = Bun.spawnSync;
    let callCount = 0;
    Bun.spawnSync = mock(() => {
      callCount++;
      // ports 8080 and 8082 are OS-bound, 8081 is reserved
      return { exitCode: [8080, 8082].includes(8079 + callCount) ? 0 : 1 };
    }) as any;

    const reserved = new Set([8081]);
    // 8080 OS-bound, 8081 reserved, 8082 OS-bound → should pick 8083
    expect(getNextPort(8080, reserved)).toBe(8083);

    Bun.spawnSync = originalSpawnSync;
  });

  test("getAssignedPorts returns ports from existing branches", () => {
    const originalSpawnSync = Bun.spawnSync;
    Bun.spawnSync = mock((cmd: string[]) => {
      if (cmd[0] === "ls") {
        return { exitCode: 0, stdout: new TextEncoder().encode("branch-a\nbranch-b\n") };
      }
      return { exitCode: 1 };
    }) as any;

    const readFileSyncSpy = spyOn(fs, "readFileSync").mockImplementation((path: any) => {
      if (String(path).includes("branch-a")) {
        return `DB_PORT="5437"\nBACKEND_PORT="8082"\nFRONTEND_PORT="3013"\n`;
      }
      if (String(path).includes("branch-b")) {
        return `DB_PORT="5438"\nBACKEND_PORT="8083"\nFRONTEND_PORT="3014"\nMANAGER_PORT="3020"\n`;
      }
      throw new Error("not found");
    });

    const reserved = getAssignedPorts();
    expect(reserved.has(5437)).toBe(true);
    expect(reserved.has(8082)).toBe(true);
    expect(reserved.has(3013)).toBe(true);
    expect(reserved.has(5438)).toBe(true);
    expect(reserved.has(8083)).toBe(true);
    expect(reserved.has(3014)).toBe(true);
    expect(reserved.has(3020)).toBe(true);

    readFileSyncSpy.mockRestore();
    Bun.spawnSync = originalSpawnSync;
  });

  test("allocatePorts does not duplicate ports assigned to existing branches", () => {
    const originalSpawnSync = Bun.spawnSync;
    Bun.spawnSync = mock((cmd: string[]) => {
      if (cmd[0] === "ls") {
        return { exitCode: 0, stdout: new TextEncoder().encode("existing\n") };
      }
      // all OS ports are free
      return { exitCode: 1 };
    }) as any;

    const readFileSyncSpy = spyOn(fs, "readFileSync").mockImplementation(() => {
      // existing branch occupies the base ports
      return `DB_PORT="5434"\nBACKEND_PORT="8080"\nBACKEND_DEBUG_PORT="5005"\nFRONTEND_PORT="3011"\n`;
    });

    const ports = allocatePorts();
    expect(ports.db).not.toBe(5434);
    expect(ports.backend).not.toBe(8080);
    expect(ports.backendDebug).not.toBe(5005);
    expect(ports.frontend).not.toBe(3011);

    readFileSyncSpy.mockRestore();
    Bun.spawnSync = originalSpawnSync;
  });
});
