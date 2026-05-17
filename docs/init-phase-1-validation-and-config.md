# Fase 1: Validação e Modelo de Configuração

## Objetivo

Fazer o `init` produzir somente configurações válidas e explícitas.

## Problemas que Esta Fase Resolve

- prompts obrigatórios aceitam vazio
- frontend ainda é implícito/hardcoded
- `.env.example`, wizard e schema não contam a mesma história

## Mudanças

1. Endurecer prompts obrigatórios em `src/actions/init.ts`

- Adicionar helper para input obrigatório com `trim()`.
- Rejeitar valor vazio para:
  - `NS_PRODUCT_NAME`
  - `NS_BACKEND_MODULE`
  - `NS_BACKEND_REPO_NAME`
  - `NS_MANAGER_REPO_NAME`
  - `NS_SEED_VOLUME` se ele continuar obrigatório nesta fase

2. Tornar frontend explícito no modelo

Opção recomendada:

- adicionar `NS_FRONTEND_REPO_NAME` em `src/lib/env.ts`
- exportar constante correspondente
- atualizar `FRONTEND_REPO` para usar `NS_FRONTEND_REPO_NAME` como fallback, não `frontend`
- pedir esse valor no wizard, com autodetecção quando possível

3. Ajustar autodetecção para preencher frontend/backend/manager com a mesma lógica

- `init` deve detectar e preencher:
  - nome do repo
  - path do repo
- se detectar parcialmente, exibir isso com clareza em vez de só assumir fallback silencioso

4. Atualizar documentação de configuração

- alinhar `.env.example`
- revisar textos do `init`
- revisar `config env --edit` indiretamente, já que reutiliza `initAction`

## Ordem Interna

1. atualizar schema/env/constants
2. atualizar wizard do `init`
3. atualizar `.env.example`
4. atualizar testes

## Arquivos Esperados

- `src/lib/env.ts`
- `src/actions/init.ts`
- `.env.example`
- testes de `init` e quaisquer testes que assumam fallback de frontend

## Impactos

### Código

- aumenta a clareza do modelo de configuração
- reduz fallback implícito no runtime

### Compatibilidade

- pode exigir migração leve de instalações existentes se `NS_FRONTEND_REPO_NAME` passar a ser obrigatório
- para reduzir impacto, aceitar transitoriamente `NS_FRONTEND_REPO` como override e só usar `NS_FRONTEND_REPO_NAME` para fallback derivado

### Testes

- criar testes para input obrigatório
- criar testes para frontend configurado explicitamente
- ajustar fixtures se o schema mudar

## Critério de Aceitação

- `init` não salva campos obrigatórios vazios
- frontend não depende mais do literal `frontend`
- `.env.example` e wizard refletem o mesmo conjunto de variáveis

## Validação

1. rodar `bun test`
2. rodar `bun x tsc --noEmit`
3. validar manualmente um first-run com respostas mínimas
