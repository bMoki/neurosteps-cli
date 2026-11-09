import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";

export type PackageManager = "npm" | "bun";

/**
 * O `node_modules` de `dir` tem exatamente as versões que o lockfile de `dir` declara.
 * O npm guarda o que instalou em `node_modules/.package-lock.json`; o bun não guarda,
 * então cada pacote do `bun.lock` é conferido no `package.json` instalado, e cada
 * pacote do primeiro nível do `node_modules` tem de estar no `bun.lock`.
 * Lockfile ou instalação ilegível conta como diferente.
 */
export function installedMatchesLockfile(dir: string, manager: PackageManager): boolean {
  try {
    return manager === "npm" ? npmMatches(dir) : bunMatches(dir);
  } catch {
    return false;
  }
}

interface NpmEntry {
  version?: string;
  optional?: boolean;
}

function npmMatches(dir: string): boolean {
  const declared = readJson<{ packages: Record<string, NpmEntry> }>(join(dir, "package-lock.json")).packages;
  const installed = readJson<{ packages: Record<string, NpmEntry> }>(join(dir, "node_modules/.package-lock.json")).packages;

  for (const [path, entry] of Object.entries(declared)) {
    if (path === "") continue;
    const current = installed[path];
    // Opcionais de outra plataforma não são instalados.
    if (!current) {
      if (entry.optional) continue;
      return false;
    }
    if (current.version !== entry.version) return false;
  }
  return Object.keys(installed).every((path) => path in declared);
}

type BunEntry = [spec: string, registry?: string, meta?: { os?: unknown; cpu?: unknown; optional?: boolean }];

function bunMatches(dir: string): boolean {
  const lock = Bun.JSONC.parse(readFileSync(join(dir, "bun.lock"), "utf8")) as { packages: Record<string, BunEntry> };
  const packages = lock.packages;

  // A chave é o caminho de nomes até o pacote: "bl/readable-stream" fica em bl/node_modules/readable-stream.
  const installedPath = (key: string): string => {
    const name = nameOf(packages[key]![0]);
    if (key === name) return join(dir, "node_modules", name);
    return join(installedPath(key.slice(0, -(name.length + 1))), "node_modules", name);
  };

  for (const [key, [spec, , meta]] of Object.entries(packages)) {
    const manifest = join(installedPath(key), "package.json");
    if (!existsSync(manifest)) {
      if (meta?.os || meta?.cpu || meta?.optional) continue;
      return false;
    }
    const version = versionOf(spec);
    // workspace:, github: e afins não têm versão para comparar; basta estar instalado.
    if (version.includes(":")) continue;
    if (readJson<{ version?: string }>(manifest).version !== version) return false;
  }
  return topLevelPackages(join(dir, "node_modules")).every((name) => name in packages);
}

/** Os pacotes da raiz do `node_modules`, com os escopos abertos (`@scope/nome`); ignora `.bin` e afins. */
function topLevelPackages(nodeModules: string): string[] {
  const visible = (path: string) => readdirSync(path).filter((entry) => !entry.startsWith("."));
  return visible(nodeModules).flatMap((entry) =>
    entry.startsWith("@") ? visible(join(nodeModules, entry)).map((name) => `${entry}/${name}`) : [entry]);
}

// "nome@versão": o separador é o primeiro @ depois do escopo, que vale também para
// "nome@npm:outro@1.0".
function nameOf(spec: string): string {
  return spec.slice(0, spec.indexOf("@", 1));
}

function versionOf(spec: string): string {
  return spec.slice(spec.indexOf("@", 1) + 1);
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}
