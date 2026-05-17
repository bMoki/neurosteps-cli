import { mkdir, readdir, readFile, rm, unlink } from "fs/promises";
import { existsSync } from "fs";
import { z } from "zod";
import { WORKTREES_DIR, readWorkspaceEnv, slugify, PRODUCT_NAME, SNAPSHOTS_DIR, listBranches } from "../lib/config";
import { dockerComposeDown, dockerVolumeCreate, dockerVolumeCopy, dockerComposeUp, dockerVolumeRm, waitForPostgres } from "../lib/docker";
import { detail, emptyLine, heading, info, spinner, warn, error } from "../lib/logger";
import { confirm } from "../lib/prompt";
import { join } from "path";

const snapshotMetaSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  volume: z.string().min(1),
  created_at: z.string().min(1),
  source_branch: z.string().min(1),
  source_volume: z.string().min(1),
});

type SnapshotMeta = z.infer<typeof snapshotMetaSchema>;

interface SnapshotDeps {
  readEnv: typeof readWorkspaceEnv;
  composeDown: typeof dockerComposeDown;
  volumeCreate: typeof dockerVolumeCreate;
  volumeRm: typeof dockerVolumeRm;
  volumeCopy: typeof dockerVolumeCopy;
  composeUp: typeof dockerComposeUp;
  waitPg: typeof waitForPostgres;
  mkdir: typeof mkdir;
  readText: (path: string) => Promise<string>;
  writeText: (path: string, content: string) => Promise<unknown>;
  readDir: typeof readdir;
  unlink: typeof unlink;
  rm: typeof rm;
  pathExists: (path: string) => boolean;
  listBranches: typeof listBranches;
  confirm: typeof confirm;
}

const defaultDeps: SnapshotDeps = {
  readEnv: readWorkspaceEnv,
  composeDown: dockerComposeDown,
  volumeCreate: dockerVolumeCreate,
  volumeRm: dockerVolumeRm,
  volumeCopy: dockerVolumeCopy,
  composeUp: dockerComposeUp,
  waitPg: waitForPostgres,
  mkdir,
  readText: (path) => readFile(path, "utf8"),
  writeText: (path, content) => Bun.write(path, content),
  readDir: readdir,
  unlink,
  rm,
  pathExists: existsSync,
  listBranches,
  confirm,
};

function getSnapshotDir(branch: string): string {
  return join(SNAPSHOTS_DIR, branch);
}

async function resolveSnapshotName(
  branch: string,
  name: string,
  deps: SnapshotDeps,
): Promise<string> {
  if (name !== "latest") return name;

  const latestPath = join(getSnapshotDir(branch), "latest");
  const latest = (await deps.readText(latestPath)).trim();
  if (!latest) {
    throw new Error(`Nenhum snapshot 'latest' encontrado para ${branch}`);
  }
  return latest;
}

async function readSnapshotMeta(
  branch: string,
  name: string,
  deps: SnapshotDeps,
): Promise<SnapshotMeta> {
  const resolvedName = await resolveSnapshotName(branch, name, deps);
  const snapshotPath = join(getSnapshotDir(branch), `${resolvedName}.json`);
  const content = await deps.readText(snapshotPath);
  const parsed = snapshotMetaSchema.safeParse(JSON.parse(content));

  if (!parsed.success) {
    throw new Error(`Metadados inválidos para snapshot '${resolvedName}'`);
  }

  return parsed.data;
}

async function listSnapshotMetas(branch: string, deps: SnapshotDeps): Promise<SnapshotMeta[]> {
  const dir = getSnapshotDir(branch);
  if (!deps.pathExists(dir)) return [];

  const entries = await deps.readDir(dir);
  const snapshotFiles = entries.filter((entry) => entry.endsWith(".json"));
  const snapshots = await Promise.all(
    snapshotFiles.map(async (file) => {
      try {
        const content = await deps.readText(join(dir, file));
        const parsed = snapshotMetaSchema.safeParse(JSON.parse(content));
        return parsed.success ? parsed.data : null;
      } catch {
        return null;
      }
    }),
  );

  return snapshots
    .filter((snapshot): snapshot is SnapshotMeta => snapshot !== null)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

async function updateLatestPointer(branch: string, deps: SnapshotDeps): Promise<void> {
  const snapshots = await listSnapshotMetas(branch, deps);
  const latestPath = join(getSnapshotDir(branch), "latest");

  if (snapshots.length === 0) {
    if (deps.pathExists(latestPath)) {
      await deps.unlink(latestPath);
    }
    return;
  }

  const latest = snapshots[0];
  if (!latest) {
    return;
  }

  await deps.writeText(latestPath, latest.name);
}

export async function snapshotAction(
  branch: string,
  name?: string,
  deps: Partial<SnapshotDeps> = {},
): Promise<void> {
  const defaulted = {
    ...defaultDeps,
    ...deps,
  };
  const { readEnv, composeDown, volumeCreate, volumeCopy, composeUp, waitPg } = defaulted;

  const s = spinner(`Criando snapshot de ${branch}...`).start();

  const env = await readEnv(branch);
  if (!env) {
    s.fail(`Branch '${branch}' não encontrada`);
    process.exit(1);
  }

  const snapshotName = name || new Date().toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).replace(/[/\s:]/g, "-");

  const branchSlug = slugify(branch);
  const snapshotSlug = slugify(snapshotName);
  const snapshotVolume = `${PRODUCT_NAME}_snapshot_${branchSlug}_${snapshotSlug}`;

  const wtDir = join(WORKTREES_DIR, branch);
  const composeFile = join(wtDir, "docker-compose.yml");

  s.text = "Parando PostgreSQL...";
  await composeDown(composeFile, env.COMPOSE_PROJECT);

  s.text = "Copiando volume do banco...";
  await volumeCreate(snapshotVolume);
  await volumeCopy(env.DB_VOLUME, snapshotVolume);

  const snapshotDir = getSnapshotDir(branch);
  await defaulted.mkdir(snapshotDir, { recursive: true });
  await defaulted.writeText(join(snapshotDir, `${snapshotName}.json`), JSON.stringify({
    name: snapshotName,
    slug: snapshotSlug,
    volume: snapshotVolume,
    created_at: new Date().toISOString(),
    source_branch: branch,
    source_volume: env.DB_VOLUME,
  }, null, 2));

  await defaulted.writeText(join(snapshotDir, "latest"), snapshotName);

  s.text = "Reiniciando PostgreSQL...";
  await composeUp(composeFile, env.COMPOSE_PROJECT);
  await waitPg(env.DB_CONTAINER, { user: env.DB_USER, database: env.DB_NAME });

  s.succeed(`Snapshot '${snapshotName}' criado para ${branch}`);
  emptyLine();
  detail("Volume", snapshotVolume);
  detail("Arquivo", join(snapshotDir, `${snapshotName}.json`));
}

export async function restoreAction(
  branch: string,
  name: string,
  force: boolean,
  deps: Partial<SnapshotDeps> = {},
): Promise<void> {
  const defaulted = { ...defaultDeps, ...deps };
  const { readEnv, composeDown, volumeRm, volumeCreate, volumeCopy, composeUp, waitPg, confirm } = defaulted;

  const s = spinner(`Restaurando snapshot em ${branch}...`).start();
  try {
    const env = await readEnv(branch);
    if (!env) {
      s.fail(`Branch '${branch}' não encontrada`);
      process.exit(1);
    }

    const snapshot = await readSnapshotMeta(branch, name, defaulted);

    if (!force) {
      s.stop();
      const shouldRestore = await confirm(`Restaurar snapshot '${snapshot.name}' em ${branch}? Isso substituirá o banco atual.`);
      if (!shouldRestore) {
        warn("Operação cancelada.");
        return;
      }
      s.start();
    }

    const wtDir = join(WORKTREES_DIR, branch);
    const composeFile = join(wtDir, "docker-compose.yml");

    s.text = "Parando PostgreSQL...";
    await composeDown(composeFile, env.COMPOSE_PROJECT);

    s.text = "Substituindo volume do banco...";
    await volumeRm(env.DB_VOLUME);
    await volumeCreate(env.DB_VOLUME);
    await volumeCopy(snapshot.volume, env.DB_VOLUME);

    s.text = "Reiniciando PostgreSQL...";
    await composeUp(composeFile, env.COMPOSE_PROJECT);
    await waitPg(env.DB_CONTAINER, { user: env.DB_USER, database: env.DB_NAME });

    s.succeed(`Snapshot '${snapshot.name}' restaurado em ${branch}`);
    emptyLine();
    detail("Snapshot", snapshot.name);
    detail("Volume origem", snapshot.volume);
    detail("Volume destino", env.DB_VOLUME);
  } catch (err) {
    s.fail(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

export async function listSnapshotsAction(
  branch?: string,
  deps: Partial<SnapshotDeps> = {},
): Promise<void> {
  const defaulted = { ...defaultDeps, ...deps };
  const branches = branch ? [branch] : defaulted.listBranches().filter((name) => defaulted.pathExists(getSnapshotDir(name)));

  if (branches.length === 0) {
    info("Nenhum snapshot encontrado.");
    return;
  }

  let foundAny = false;

  for (const branchName of branches) {
    const snapshots = await listSnapshotMetas(branchName, defaulted);
    if (snapshots.length === 0) {
      if (branch) {
        info(`Nenhum snapshot encontrado para ${branchName}.`);
      }
      continue;
    }

    foundAny = true;
    heading(`Snapshots: ${branchName}`);
    for (const snapshot of snapshots) {
      detail(snapshot.name, `${snapshot.created_at} · ${snapshot.volume}`);
    }
    emptyLine();
  }

  if (!foundAny) {
    info(branch ? `Nenhum snapshot encontrado para ${branch}.` : "Nenhum snapshot encontrado.");
  }
}

export async function rmSnapshotAction(
  branch: string,
  name: string,
  force: boolean,
  deps: Partial<SnapshotDeps> = {},
): Promise<void> {
  const defaulted = { ...defaultDeps, ...deps };
  const { confirm, volumeRm } = defaulted;

  try {
    const snapshot = await readSnapshotMeta(branch, name, defaulted);

    if (!force) {
      const shouldRemove = await confirm(`Remover snapshot '${snapshot.name}' de ${branch}?`);
      if (!shouldRemove) {
        warn("Operação cancelada.");
        return;
      }
    }

    await volumeRm(snapshot.volume);
    await defaulted.rm(join(getSnapshotDir(branch), `${snapshot.name}.json`), { force: true });
    await updateLatestPointer(branch, defaulted);

    info(`Snapshot '${snapshot.name}' removido de ${branch}.`);
  } catch (err) {
    error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
