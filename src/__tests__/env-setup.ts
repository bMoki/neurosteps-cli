// Test setup: runs before env.ts is imported. The suite gets its own config dir,
// base dir, state dir and HOME under a temp folder, so it never reads or writes the real
// ~/.config/ns or ~/Developer of whoever runs it. HOME only reaches child
// processes: Bun's os.homedir() keeps the real home, so code under test must take
// its paths from NS_CONFIG_DIR / NS_BASE_DIR / NS_STATE_DIR or from injected deps.
import { afterAll } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const root = mkdtempSync(join(tmpdir(), "ns-cli-test-"));
const home = join(root, "home");
const baseDir = join(root, "Developer");
mkdirSync(home);
mkdirSync(baseDir);

for (const key of Object.keys(process.env)) {
  if (key.startsWith("NS_")) delete process.env[key];
}

process.env.HOME = home;
process.env.NS_CONFIG_DIR = join(home, ".config", "ns");
process.env.NS_BASE_DIR = baseDir;
process.env.NS_STATE_DIR = join(home, ".local", "state", "ns");
process.env.NS_PRODUCT_NAME = "neurosteps";
process.env.NS_BACKEND_MODULE = "scalemed";
process.env.NS_BACKEND_CORE_MODULE = "scalemed-core";
process.env.NS_BACKEND_REPO_NAME = "scalemed-backend";
process.env.NS_MANAGER_REPO_NAME = "neurosteps-manager";
process.env.NS_SEED_VOLUME = "scalemed-backend_neurosteps_bd_volume";

afterAll(() => rmSync(root, { recursive: true, force: true }));
