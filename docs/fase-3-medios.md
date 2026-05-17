# Fase 3: Comandos Médios

## Objetivo
Implementar comandos com lógica moderada.

## Comandos

### `prepare <branch>`
1. `dockerComposeUp()`
2. Esperar `pg_isready`
3. `registerAlias()` para backend, frontend, manager

### `stop <branch>`
1. `dockerComposeDown()`
2. `removeAlias()` para web, api, manager
3. `kill -9` nas portas (backend, frontend, manager)

### `start <branch>`
1. Usa o runtime centralizado da branch para subir DB, iniciar proxy Portless e registrar aliases
2. Spawn terminals no macOS:
   - Backend: `cd backend && QUARKUS_HTTP_PORT=$PORT mvn quarkus:dev`
   - Frontend: `cd frontend && npm start`
   - Manager (se existir): `cd manager && npm run dev`

### `db start <branch>`
1. `dockerComposeUp()`
2. Esperar `pg_isready`

### `db reset <branch>`
1. Confirmar com usuário
2. `dockerComposeDown()`
3. `dockerVolumeRm()`
4. Seed do volume original
5. `dockerComposeUp()`
6. Esperar `pg_isready`

### `open <branch> [--no-prepare] [--app <name>]`
1. Se não `--no-prepare`: `prepare(branch)`
2. Se proxy não rodando: `startProxy()`
3. Abrir IDE via `open` no macOS

### `close <branch> [--app <name>]`
1. `stop(branch)`
2. AppleScript no macOS para fechar janela do IDE

## Testes
- Mock de todas as dependências externas
- Verificar sequência correta de operações

## Critério de aceitação
- [ ] Todos os comandos implementados
- [ ] Todos os testes passando
- [ ] Coverage ≥ 80%
