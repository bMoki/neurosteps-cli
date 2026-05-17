# Fase 4: Comandos Complexos

## Objetivo
Implementar comandos com lógica complexa.

## Comandos

### `new <branch> [base-branch] [--no-manager]`
1. Validar repos existem
2. Verificar se branch existe no origin
3. Criar branch local em cada repo a partir de `base-branch` ou `master`
4. Criar worktrees
5. Alocar portas, incluindo porta de debug do backend para IntelliJ
7. Gerar `.workspace.env`
8. Copiar templates (application-dev.properties, .env.local, docker-compose.yml)
9. Gerar configs VS Code e IntelliJ, incluindo run/debug configurations
10. Seed DB do volume original

### `rm <branch> [--purge]`
1. Confirmar
2. `dockerComposeDown()`
3. Se `--purge`: `dockerVolumeRm()`
4. `git worktree remove`
5. `git branch -D`

### `add manager <branch> [--base <branch>] [--port <port>]`
1. Verificar manager repo existe
2. Verificar manager não existe ainda
3. Criar branch no manager repo
4. Criar worktree
5. Alocar ou validar `MANAGER_PORT`
6. Gerar `.env.local`
7. Atualizar `.workspace.env`
8. Atualizar VS Code workspace

### `db snapshot <branch> [name]`
1. Parar PostgreSQL
2. Criar volume snapshot
3. Copiar dados
4. Salvar metadata JSON
5. Atualizar `latest` pointer
6. Restart PostgreSQL

### `db restore <branch> <name> [--force]`
1. Confirmar (se não `--force`)
2. Parar PostgreSQL
3. Remover volume atual
4. Copiar do snapshot
5. Restart PostgreSQL

### `doctor <branch>`
1. Validar `.workspace.env`
2. Validar configs (vite.config.ts, .env.local)
3. Validar Docker volume
4. Validar container PostgreSQL
5. Validar Portless aliases

### `workspace template save <branch>`
1. Copiar `misc.xml`
2. Copiar run configs (com reverse sed)
3. Copiar outros configs

### `workspace template apply <branch>`
1. Copiar templates (com sed de placeholders)

## Testes
- Testes de integração leves (com tmp dirs)
- Mock de git, docker, file system

## Critério de aceitação
- [ ] Todos os comandos implementados
- [ ] Todos os testes passando
- [ ] Coverage ≥ 80%
