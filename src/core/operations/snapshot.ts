import { existsSync } from "fs";
import { mkdir, readdir, readFile, rm, unlink } from "fs/promises";
import { join } from "path";
import { z } from "zod";
import { PRODUCT_NAME, SNAPSHOTS_DIR, WORKTREES_DIR, listBranches, readWorkspaceEnv, slugify, type WorkspaceEnv } from "../../lib/config";
import { dockerComposeDown, dockerComposeUp, dockerVolumeCopy, dockerVolumeCreate, dockerVolumeRm, waitForPostgres } from "../../lib/docker";
import type { NsContext } from "../context";
import { asNsError, conflito, naoEncontrado, preCondicao } from "../errors";

/** Um Snapshot do banco, guardado na branch de origem. */
export interface Snapshot {
  branch: string;      // branch de origem
  name: string;
  ref: string;         // `origem:nome`
  createdAt: string;   // ISO 8601
  volume: string;
}

/** Os Snapshots de uma branch de origem, do mais novo para o mais antigo. Órfã: a branch já não tem worktree. */
export interface SnapshotGroup {
  branch: string;
  orphan: boolean;
  snapshots: Snapshot[];
}

export interface DbSnapshotInput {
  branch: string;
  name?: string;       // default: data e hora atuais
  replace?: boolean;   // sem ele, um nome que a branch já usa é `conflito`
}

export interface DbSnapshotsInput {
  branch?: string;   // sem branch: todas as pastas de Snapshots, inclusive de branches removidas
}

export interface DbRestoreInput {
  branch: string;   // branch alvo
  ref: string;      // `nome`, `origem:nome`, ou `latest` no lugar do nome
}

/** O que Restaurar vai fazer: o Snapshot resolvido e o volume que ele substitui. */
export interface DbRestorePreview {
  branch: string;
  volume: string;
  snapshot: Snapshot;
}

/** Um Snapshot da branch pelo nome, ou `latest` para o mais recente. */
export interface DbSnapshotNameInput {
  branch: string;
  name: string;
}

export interface SnapshotDeps {
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
};

const snapshotMetaSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  volume: z.string().min(1),
  created_at: z.string().min(1),
  source_branch: z.string().min(1),
  source_volume: z.string().min(1),
});

type SnapshotMeta = z.infer<typeof snapshotMetaSchema>;

/** Tirar snapshot: para o banco, copia o volume para um volume de Snapshot e sobe o banco de novo. */
export async function runDbSnapshot(input: DbSnapshotInput, ctx: NsContext, deps: Partial<SnapshotDeps> = {}): Promise<Snapshot> {
  const d = { ...defaultDeps, ...deps };
  const { branch } = input;
  const env = await readEnv(branch, d);
  if (input.name && /[:/]/.test(input.name)) {
    throw preCondicao("Nome de snapshot não pode conter ':' nem '/'", "O ':' separa a branch de origem do nome, como em 'master:seed'.");
  }
  if (input.name === "latest") {
    throw preCondicao("'latest' é reservado: aponta para o snapshot mais recente da branch", "Escolha outro nome.");
  }

  const name = input.name || defaultName();
  const slug = slugify(name);
  const baseVolume = `${PRODUCT_NAME}_snapshot_${slugify(branch)}_${slug}`;
  const dir = snapshotDir(branch);
  const createdAt = new Date().toISOString();
  const existing = d.pathExists(snapshotFile(branch, name)) ? await readSnapshot(branch, name, d) : null;
  if (existing && !input.replace) {
    throw conflito(`Já existe um snapshot '${name}' em ${branch}`, "Confirme a substituição ou escolha outro nome.");
  }
  // Substituir copia para um volume novo e só apaga o antigo depois: se a cópia falhar, o Snapshot anterior fica intacto.
  const volume = existing?.volume === baseVolume ? `${baseVolume}_${Date.now().toString(36)}` : baseVolume;

  await withStoppedDatabase(branch, env, ctx, d, async () => {
    ctx.emit({ step: "snapshot:copy", label: "Copiando volume do banco..." });
    await d.volumeCreate(volume);
    await d.volumeCopy(env.DB_VOLUME, volume);
    await d.mkdir(dir, { recursive: true });
    const meta: SnapshotMeta = { name, slug, volume, created_at: createdAt, source_branch: branch, source_volume: env.DB_VOLUME };
    await d.writeText(snapshotFile(branch, name), JSON.stringify(meta, null, 2));
    await d.writeText(join(dir, "latest"), name);
    if (existing) await d.volumeRm(existing.volume);
  });
  return toSnapshot(branch, { name, volume, created_at: createdAt });
}

/**
 * Lista os Snapshots por branch de origem. Sem branch, traz cada pasta de Snapshots: primeiro as das
 * branches com worktree, depois as órfãs, de branches removidas sem `purge`.
 */
export async function runDbSnapshots(input: DbSnapshotsInput, _ctx: NsContext, deps: Partial<SnapshotDeps> = {}): Promise<SnapshotGroup[]> {
  const d = { ...defaultDeps, ...deps };
  const active = new Set(d.listBranches());
  const group = async (branch: string): Promise<SnapshotGroup> =>
    ({ branch, orphan: !active.has(branch), snapshots: await listSnapshots(branch, d) });
  if (input.branch) return [await group(input.branch)];
  // Um arquivo solto na pasta de Snapshots não é uma branch: fica de fora em vez de derrubar a lista.
  const folder = (branch: string) => group(branch).catch(() => null);
  const folders = d.pathExists(SNAPSHOTS_DIR)
    ? (await d.readDir(SNAPSHOTS_DIR).catch((error) => { throw asNsError(error); })).filter((name) => !name.startsWith(".")).sort()
    : [];
  const groups = (await Promise.all(folders.map(folder))).filter((found): found is SnapshotGroup => found !== null);
  return [...groups.filter(({ orphan }) => !orphan), ...groups.filter(({ orphan }) => orphan)];
}

/** Prévia de Restaurar: resolve a referência sem mexer no banco. */
export async function runDbRestorePreview(input: DbRestoreInput, _ctx: NsContext, deps: Partial<SnapshotDeps> = {}): Promise<DbRestorePreview> {
  const d = { ...defaultDeps, ...deps };
  const env = await readEnv(input.branch, d);
  const { origin, name } = parseRef(input.ref, input.branch);
  return { branch: input.branch, volume: env.DB_VOLUME, snapshot: await readSnapshot(origin, name, d) };
}

/**
 * Restaurar: substitui o banco da branch alvo pelo Snapshot, que pode ser de outra branch.
 * Só mexe no banco: Serviços Rodando continuam como estão.
 */
export async function runDbRestore(input: DbRestoreInput, ctx: NsContext, deps: Partial<SnapshotDeps> = {}): Promise<DbRestorePreview> {
  const d = { ...defaultDeps, ...deps };
  const env = await readEnv(input.branch, d);
  const { origin, name } = parseRef(input.ref, input.branch);
  const snapshot = await readSnapshot(origin, name, d);

  await withStoppedDatabase(input.branch, env, ctx, d, async () => {
    ctx.emit({ step: "restore:replace", label: "Substituindo volume do banco..." });
    await d.volumeRm(env.DB_VOLUME);
    await d.volumeCreate(env.DB_VOLUME);
    await d.volumeCopy(snapshot.volume, env.DB_VOLUME);
  });
  return { branch: input.branch, volume: env.DB_VOLUME, snapshot };
}

/** Acha um Snapshot da branch pelo nome, ou `latest`. */
export async function runDbSnapshotFind(input: DbSnapshotNameInput, _ctx: NsContext, deps: Partial<SnapshotDeps> = {}): Promise<Snapshot> {
  return readSnapshot(input.branch, input.name, { ...defaultDeps, ...deps });
}

/** Remove um Snapshot da branch: o volume e o arquivo. `latest` passa a apontar para o mais novo que sobrou. */
export async function runDbRmSnapshot(input: DbSnapshotNameInput, _ctx: NsContext, deps: Partial<SnapshotDeps> = {}): Promise<Snapshot> {
  const d = { ...defaultDeps, ...deps };
  const snapshot = await readSnapshot(input.branch, input.name, d);
  await step(async () => {
    await d.volumeRm(snapshot.volume);
    await d.rm(snapshotFile(input.branch, snapshot.name), { force: true });
    await updateLatestPointer(input.branch, d);
  });
  return snapshot;
}

/** Apaga todos os Snapshots da branch, volumes e pasta. Usado por Remover branch com `purge`. */
export async function removeBranchSnapshots(branch: string, deps: Partial<SnapshotDeps> = {}): Promise<void> {
  const d = { ...defaultDeps, ...deps };
  for (const snapshot of await listSnapshots(branch, d)) {
    await d.volumeRm(snapshot.volume);
  }
  const dir = snapshotDir(branch);
  if (d.pathExists(dir)) {
    await d.rm(dir, { recursive: true, force: true });
  }
}

/** O arquivo de metadados de um Snapshot. */
export function snapshotFile(branch: string, name: string): string {
  return join(snapshotDir(branch), `${name}.json`);
}

function snapshotDir(branch: string): string {
  return join(SNAPSHOTS_DIR, branch);
}

async function readEnv(branch: string, d: SnapshotDeps): Promise<WorkspaceEnv> {
  const env = await d.readEnv(branch);
  if (!env) throw naoEncontrado(`Branch '${branch}' não encontrada`, "Rode 'ns status' para ver as branches disponíveis.");
  return env;
}

async function withStoppedDatabase(branch: string, env: WorkspaceEnv, ctx: NsContext, d: SnapshotDeps, work: () => Promise<void>): Promise<void> {
  const composeFile = join(WORKTREES_DIR, branch, "docker-compose.yml");
  // O banco volta a subir mesmo se a cópia falhar, para a branch não ficar sem banco.
  await step(async () => {
    ctx.emit({ step: "db:stop", label: "Parando PostgreSQL..." });
    await d.composeDown(composeFile, env.COMPOSE_PROJECT);
    try {
      await work();
    } finally {
      ctx.emit({ step: "db:start", label: "Reiniciando PostgreSQL..." });
      await d.composeUp(composeFile, env.COMPOSE_PROJECT);
      await d.waitPg(env.DB_CONTAINER, { user: env.DB_USER, database: env.DB_NAME });
    }
  });
}

async function step(work: () => Promise<void>): Promise<void> {
  await work().catch((error) => { throw asNsError(error); });
}

function parseRef(ref: string, target: string): { origin: string; name: string } {
  const colon = ref.indexOf(":");
  if (colon === -1) return { origin: target, name: ref };
  return { origin: ref.slice(0, colon), name: ref.slice(colon + 1) };
}

async function readSnapshot(branch: string, name: string, d: SnapshotDeps): Promise<Snapshot> {
  const resolved = name === "latest" ? await readLatest(branch, d) : name;
  const path = snapshotFile(branch, resolved);
  if (!d.pathExists(path)) throw notFound(`Snapshot '${branch}:${resolved}' não encontrado`, branch);
  const meta = await readMeta(path, d).catch((error) => { throw asNsError(error); });
  if (!meta) throw preCondicao(`Metadados inválidos para snapshot '${branch}:${resolved}'`, `Confira o arquivo ${path}.`);
  return toSnapshot(branch, meta);
}

async function readLatest(branch: string, d: SnapshotDeps): Promise<string> {
  const path = join(snapshotDir(branch), "latest");
  const latest = d.pathExists(path) ? (await d.readText(path).catch((error) => { throw asNsError(error); })).trim() : "";
  if (!latest) throw notFound(`Nenhum snapshot 'latest' encontrado para ${branch}`, branch);
  return latest;
}

function notFound(message: string, branch: string) {
  return naoEncontrado(message, `Rode 'ns db snapshots ${branch}' para ver os snapshots da branch.`);
}

async function listSnapshots(branch: string, d: SnapshotDeps): Promise<Snapshot[]> {
  const dir = snapshotDir(branch);
  if (!d.pathExists(dir)) return [];

  const files = (await d.readDir(dir)).filter((entry) => entry.endsWith(".json"));
  const metas = await Promise.all(files.map((file) => readMeta(join(dir, file), d).catch(() => null)));
  return metas
    .filter((meta): meta is SnapshotMeta => meta !== null)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((meta) => toSnapshot(branch, meta));
}

/** Os metadados do arquivo, ou null se não forem de um Snapshot. Erro de leitura sobe. */
async function readMeta(path: string, d: SnapshotDeps): Promise<SnapshotMeta | null> {
  const content = await d.readText(path);
  try {
    const parsed = snapshotMetaSchema.safeParse(JSON.parse(content));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function updateLatestPointer(branch: string, d: SnapshotDeps): Promise<void> {
  const [latest] = await listSnapshots(branch, d);
  const path = join(snapshotDir(branch), "latest");
  if (latest) {
    await d.writeText(path, latest.name);
  } else if (d.pathExists(path)) {
    await d.unlink(path);
  }
}

function toSnapshot(branch: string, meta: Pick<SnapshotMeta, "name" | "volume" | "created_at">): Snapshot {
  return { branch, name: meta.name, ref: `${branch}:${meta.name}`, createdAt: meta.created_at, volume: meta.volume };
}

function defaultName(): string {
  return new Date().toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).replace(/[/\s:]/g, "-");
}
