# Fase 0: Setup

## Objetivo
Criar estrutura do projeto, `.agent`, e setup de testes.

## Checklist
- [ ] Criar `cli/.agent` com regras e contexto
- [ ] Configurar `bun:test` (já nativo)
- [ ] Criar estrutura de diretórios `src/__tests__/`
- [ ] Criar utilitários de teste (mocks, fixtures)

## Arquivos
- `cli/.agent` — Guia para agentes/AI
- `cli/src/__tests__/setup.ts` — Test utilities
- `cli/src/__tests__/fixtures/` — Sample data

## Critério de aceitação
- `bun test` roda sem erros (mesmo que 0 testes)
- `.agent` está completo e útil
