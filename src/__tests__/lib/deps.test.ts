import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { installedMatchesLockfile } from "../../lib/deps";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ns-deps-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function write(path: string, content: unknown): void {
  const full = join(dir, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, typeof content === "string" ? content : JSON.stringify(content));
}

describe("installedMatchesLockfile com npm", () => {
  const declared = {
    "": { name: "app" },
    "node_modules/react": { version: "18.3.1" },
    "node_modules/@esbuild/linux-x64": { version: "0.21.5", optional: true },
  };

  test("bate quando o instalado tem as versões declaradas", () => {
    write("package-lock.json", { packages: declared });
    write("node_modules/.package-lock.json", { packages: { "node_modules/react": { version: "18.3.1" } } });

    expect(installedMatchesLockfile(dir, "npm")).toBe(true);
  });

  test("difere com versão diferente, pacote faltando ou pacote a mais", () => {
    write("package-lock.json", { packages: declared });

    write("node_modules/.package-lock.json", { packages: { "node_modules/react": { version: "18.2.0" } } });
    expect(installedMatchesLockfile(dir, "npm")).toBe(false);

    write("node_modules/.package-lock.json", { packages: {} });
    expect(installedMatchesLockfile(dir, "npm")).toBe(false);

    write("node_modules/.package-lock.json", { packages: {
      "node_modules/react": { version: "18.3.1" },
      "node_modules/lodash": { version: "4.17.21" },
    } });
    expect(installedMatchesLockfile(dir, "npm")).toBe(false);
  });

  test("sem o registro do que foi instalado, difere", () => {
    write("package-lock.json", { packages: declared });

    expect(installedMatchesLockfile(dir, "npm")).toBe(false);
  });
});

describe("installedMatchesLockfile com bun", () => {
  const lock = `{
    "lockfileVersion": 1,
    "packages": {
      "bl": ["bl@4.1.0", "", {}, "sha512-a"],
      "bl/readable-stream": ["readable-stream@3.6.2", "", {}, "sha512-b"],
      "@scope/pkg": ["@scope/pkg@1.0.0", "", {}, "sha512-c"],
      "@img/sharp-linux-x64": ["@img/sharp-linux-x64@0.33.0", "", { "os": "linux", "cpu": "x64" }, "sha512-d"],
    },
  }`;

  function install(versions: Record<string, string>): void {
    for (const [path, version] of Object.entries(versions)) write(`${path}/package.json`, { version });
  }

  test("confere cada pacote do bun.lock no package.json instalado, inclusive os aninhados", () => {
    write("bun.lock", lock);
    install({
      "node_modules/bl": "4.1.0",
      "node_modules/bl/node_modules/readable-stream": "3.6.2",
      "node_modules/@scope/pkg": "1.0.0",
    });

    expect(installedMatchesLockfile(dir, "bun")).toBe(true);
  });

  test("difere quando há um pacote instalado que o bun.lock não declara", () => {
    write("bun.lock", lock);
    install({
      "node_modules/bl": "4.1.0",
      "node_modules/bl/node_modules/readable-stream": "3.6.2",
      "node_modules/@scope/pkg": "1.0.0",
      "node_modules/@scope/extra": "1.0.0",
    });

    expect(installedMatchesLockfile(dir, "bun")).toBe(false);
  });

  test("pacote sem versão de registro (github:, workspace:) basta estar instalado", () => {
    write("bun.lock", `{ "packages": { "lib": ["lib@github:org/lib#abc123", {}, "abc123"] } }`);
    install({ "node_modules/lib": "0.0.1" });

    expect(installedMatchesLockfile(dir, "bun")).toBe(true);
  });

  test("difere quando um pacote aninhado tem outra versão ou falta", () => {
    write("bun.lock", lock);
    install({ "node_modules/bl": "4.1.0", "node_modules/@scope/pkg": "1.0.0" });
    expect(installedMatchesLockfile(dir, "bun")).toBe(false);

    install({ "node_modules/bl/node_modules/readable-stream": "3.6.0" });
    expect(installedMatchesLockfile(dir, "bun")).toBe(false);
  });
});
