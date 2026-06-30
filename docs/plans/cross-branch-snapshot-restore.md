# Plano de implementação — `db restore` cross-branch

Referência de decisão: [ADR 0001](../adr/0001-cross-branch-snapshot-restore.md) · Glossário: [CONTEXT.md](../../CONTEXT.md)

Objetivo: permitir restaurar no banco de uma branch um snapshot que pertence a **outra** branch, endereçado por referência qualificada `branch:nome` (ex.: `ns db restore minha-branch master:snapshot1`).

## 1. `src/actions/snapshot.ts` (núcleo da mudança)

**Novo helper — parsing de ref**
```ts
function parseSnapshotRef(ref: string, targetBranch: string): { originBranch: string; name: string }
```
- Divide no **primeiro** `:`. Com `:` → `{ originBranch: antes, name: depois }`. Sem `:` → `{ originBranch: targetBranch, name: ref }`.
- Seguro: git proíbe `:` em branch e a criação rejeita `:` em nome, então há no máximo um `:`.

**Novo helper — string da ref (exibição)**
```ts
function snapshotRef(branch: string, name: string): string  // `${branch}:${name}`
```

**`restoreAction(branch, name, force, deps, dryRun)`** — assinatura inalterada; `name` agora é uma ref.
- `parseSnapshotRef(name, branch)` → `originBranch`, `bareName`.
- `env = readEnv(branch)` continua sendo o **alvo** (volume destino).
- Trocar `readSnapshotMeta(branch, name)` → `readSnapshotMeta(originBranch, bareName)` (lookup na pasta da origem; `latest` resolve na origem).
- Mensagens: se `originBranch !== branch`, confirmação/dry-run/sucesso nomeiam origem e destino
  (`Restaurar 'master:snap1' (origem: master) em 'minha-branch'? …`); se iguais, mantém **exatamente** o texto atual.
- Gate = snapshot existe (sem checar worktree da origem). Erro "não encontrado" nomeia a origem.

**`snapshotAction`** — validar nome: se contém `:`, falhar com erro claro antes de qualquer operação.

**`listSnapshotsAction`** — rótulo de cada linha vira `snapshotRef(branchName, s.name)` (no agrupado e no filtrado).
No `--json`, cada entry ganha `ref: snapshotRef(branch, name)` mantendo `name`.

**Novo export — para o `rm --purge`**
```ts
export async function removeBranchSnapshots(branch: string, deps?: Partial<SnapshotDeps>): Promise<void>
```
- Enumera metas via `listSnapshotMetas`, `volumeRm` em cada `snapshot.volume`, depois `rm(getSnapshotDir(branch), {recursive, force})`.

## 2. `src/commands/db.ts`
- `restore`: renomear o argumento `<name>` → `<ref>` e atualizar a descrição para mencionar `branch:nome` / cross-branch.
- Sem mudança de wiring (o action já recebe a ref como 2º posicional).

## 3. `src/actions/rm.ts`
- Adicionar dep injetável `rmSnapshots: typeof removeBranchSnapshots` (default = import de `snapshot.ts`).
- Dentro do bloco `if (purge)`, após remover o volume vivo, adicionar `step("Removendo snapshots...", …, () => rmSnapshots(branch))`.
- No `dryRun`, quando `purge`, adicionar `hint` informando que os snapshots da branch (volumes + pasta) seriam removidos.

## 4. `src/commands/completion.ts`
Hoje `restore` e `rm-snapshot` compartilham `__ns_snapshot_names` (nomes crus escopados à branch do 3º token). Precisam **divergir**:
- **`restore`** (ref no 4º token): nova função que lista uma **lista plana de todas as refs** — para cada branch em `WORKTREES_DIR`/`SNAPSHOTS_DIR`, emite `branch:nome` para cada `.json` + `branch:latest`.
- **`rm-snapshot`**: mantém `__ns_snapshot_names` (nomes crus da branch do 3º token).
- Replicar a divergência nos três renderers: `renderFishCompletion`, `renderBashCompletion`, `renderZshCompletion`
  (separar `DB_SNAPSHOT_NAME_SUBCOMMANDS` em "restore→refs" vs "rm-snapshot→nomes").

## 5. `README.md`
- Tabela de snapshots: adicionar linha `ns db restore <alvo> <origem>:<nome>` (cross-branch) e ajustar a explicação de `latest`.
- Seção do `rm`/`--purge`: documentar que `--purge` agora remove também os snapshots da branch.

## 6. Testes
- **`src/__tests__/actions/snapshot.test.ts`**: restore cross-branch (lookup na origem, volume copy no alvo); ref sem `:` = origem=alvo (retrocompat); `master:latest` resolve latest da origem; criação rejeita `:`; listagem mostra `branch:nome`; `--json` tem `ref`.
- **`src/__tests__/actions/rm.test.ts`**: `--purge` chama `removeBranchSnapshots`; soft **não** chama; dry-run com purge menciona snapshots.
- Sem arquivo de teste de completion hoje — fora de escopo; vale verificação manual via `ns completion fish`.

## Ordem sugerida de execução
1. `snapshot.ts` (parsing, restore, list, validação, `removeBranchSnapshots`) + testes.
2. `db.ts` (descrição/arg).
3. `rm.ts` (purge cascade) + testes.
4. `completion.ts` (divergência restore/rm-snapshot).
5. `README.md`.
6. `graphify update .` para atualizar o grafo (per CLAUDE.md).

## Pontos sem mudança (confirmação)
- Esquema de nome de volume de snapshot (`{PRODUCT}_snapshot_{branchSlug}_{snapshotSlug}`) — já namespaced por branch.
- Ponteiro `latest` (arquivo `snapshots/<branch>/latest`) — só muda a pasta consultada.
- `rm-snapshot` — assinatura e comportamento intactos.
