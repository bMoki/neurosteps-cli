# Fase 2: Comandos Simples

## Objetivo
Implementar comandos que são basicamente leitura/forward.

## Comandos

### `status [branch]`
- Se branch fornecido: mostra status de uma branch
- Se não: itera sobre todas as branches em `worktrees/`
- Lê `.workspace.env` de cada branch
- Verifica `docker ps` para container do DB
- Verifica `portless list` para aliases

### `db port <branch>`
- Lê e imprime `DB_PORT`

### `db logs <branch>`
- `docker logs -f <container>`

### `portless <branch>`
- Registra aliases para backend e frontend
- Se manager existir, registra também

### `db open <branch>`
- Abre o diretório da branch no app de banco configurado via `open -a` no macOS

### `config ...`
- Lê/escreve `~/.config/ns/settings.json` e `~/.config/ns/env.json`
- Detecta apps instalados em `/Applications` no macOS

## Testes
- Mock das funções de lib
- Verificar que comandos bash equivalentes são chamados com args corretos

## Critério de aceitação
- [ ] Todos os comandos implementados em TypeScript
- [ ] Todos os testes passando
- [ ] Coverage ≥ 80%
