# Fase 4: Readiness Externa e Polimento

## Objetivo

Fechar o fluxo do `init` para que ele deixe claro o que a CLI já consegue fazer e o que ainda depende do ambiente externo.

## Problemas que Esta Fase Resolve

- `seed volume` entra cedo demais no wizard
- `init` ainda mistura bootstrap local com pré-requisitos operacionais externos
- `reloadEnv()` continua com semântica fraca para o processo atual

## Mudanças

1. Reavaliar `NS_SEED_VOLUME`

Opção recomendada:

- tornar o prompt adiado ou opcional em `init`
- exigir/validar esse valor apenas quando necessário em `new`/seed/reset

Alternativa conservadora:

- manter no `init`, mas marcar explicitamente como dependência futura de operações de DB

2. Revisar `reloadEnv()` e expectativa do fluxo atual

Possibilidades:

- recalcular config derivada corretamente
- ou remover a ideia de “recarregar para o mesmo processo” e manter `init` auto-suficiente sem depender disso

3. Melhorar readiness guidance

- no final do `init`, listar dependências externas detectáveis:
  - repos configurados ou ausentes
  - Docker não verificado ainda
  - portless não verificado ainda
  - seed volume pendente

4. Opcional: criar comando/flag de verificação pós-init

Exemplos:

- `ns init --doctor`
- ou orientação explícita para `ns doctor <branch>` após `new`

## Ordem Interna

1. decidir tratamento de `NS_SEED_VOLUME`
2. ajustar `reloadEnv()` ou remover dependência conceitual dele
3. melhorar resumo/readiness final
4. atualizar documentação

## Arquivos Esperados

- `src/actions/init.ts`
- `src/lib/env.ts`
- possivelmente `src/actions/new.ts`
- possivelmente `src/actions/clear-db.ts`
- documentação do setup

## Impactos

### Código

- pode tocar fluxo de configuração e alguns comandos que exigem seed volume

### Compatibilidade

- se `NS_SEED_VOLUME` deixar de ser obrigatório no `init`, melhora first-run sem quebrar installs existentes
- exige revisar mensagens de erro dos comandos que dependem dele

### Testes

- adicionar cenários com seed volume ausente mas `init` bem-sucedido
- adicionar cenários de erro mais claros em comandos que realmente usam seed volume

## Critério de Aceitação

- `init` fica honesto sobre o que foi concluído
- dependências externas pendentes ficam explícitas
- a semântica de recarga de config deixa de ser enganosa

## Validação

1. rodar `bun test`
2. rodar `bun x tsc --noEmit`
3. validar manualmente first-run sem repos e sem seed volume
