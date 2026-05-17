# Fase 5: Full Coverage

## Objetivo
100% de cobertura de testes em todo o CLI.

## Checklist
- [ ] `lib/config.ts` — 100%
- [ ] `lib/ports.ts` — 100%
- [ ] `lib/shell.ts` — 100%
- [ ] `lib/docker.ts` — 100%
- [ ] `lib/git.ts` — 100%
- [ ] `lib/portless.ts` — 100%
- [ ] `lib/templates.ts` — 100%
- [ ] `commands/init.ts` — 100%
- [ ] `commands/prepare.ts` — 100%
- [ ] `commands/dev.ts` — 100%
- [ ] `commands/stop.ts` — 100%
- [ ] `commands/status.ts` — 100%
- [ ] `commands/portless.ts` — 100%
- [ ] `commands/add.ts` — 100%
- [ ] `commands/branch.ts` — 100%
- [ ] `commands/open-close.ts` — 100%
- [ ] `commands/db.ts` — 100%
- [ ] `commands/doctor.ts` — 100%
- [ ] `commands/workspace.ts` — 100%
- [ ] `commands/config.ts` — 100%
- [ ] `commands/completion.ts` — 100%
- [ ] `index.ts` — 100%

## Como rodar
```bash
cd cli
bun test --coverage
```

## Critério de aceitação
- [ ] `bun test --coverage` mostra 100% em todos os arquivos
- [ ] Nenhum teste falha
- [ ] Build do binário funciona: `bun run build`
- [ ] Binário instalado funciona: `ns --help`
