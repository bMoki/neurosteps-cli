# Fase 3: Alinhamento dos Templates com a Configuração

## Objetivo

Garantir que os templates embutidos instalados pelo bootstrap reflitam os valores configurados pelo usuário.

## Problemas que Esta Fase Resolve

- `init` coleta `NS_DB_*`, mas templates embutidos ainda hardcodam valores
- first-run com configuração avançada gera falsa expectativa
- `new`, `doctor --fix` e `template` dependem desses templates

## Mudanças

1. Revisar templates embutidos em `src/lib/bootstrap.ts`

- substituir hardcodes de DB por placeholders consistentes
- alinhar placeholders entre bootstrap e `copyTemplate`

2. Garantir que os consumidores passem todas as variáveis necessárias

Alvos principais:

- `src/actions/new.ts`
- `src/actions/doctor.ts`
- `src/actions/template.ts`
- qualquer outro ponto que renderize template embutido

3. Revisar templates de DB e IDE

- backend properties
- datasource de IDE
- `.env.local` de frontend/manager
- qualquer template que dependa de host/porta/produto/DB

4. Revisar política de preservação

- manter comportamento atual: template local existente não é sobrescrito no bootstrap
- documentar que correções de template só entram automaticamente em instalação ausente

## Ordem Interna

1. padronizar placeholders
2. atualizar templates embutidos
3. ajustar variáveis passadas pelos consumers
4. ajustar testes

## Arquivos Esperados

- `src/lib/bootstrap.ts`
- `src/lib/templates.ts` se for necessário expandir utilitários
- `src/actions/new.ts`
- `src/actions/doctor.ts`
- `src/actions/template.ts`
- testes de bootstrap e actions que consomem templates

## Impactos

### Código

- risco moderado, porque afeta geração de arquivos usados por múltiplos comandos

### Compatibilidade

- instalações novas ficam melhores imediatamente
- instalações antigas com templates preservados podem continuar usando versões antigas até refresh manual

### Testes

- adicionar asserts para placeholders de DB
- validar que config avançada aparece nos arquivos renderizados

## Critério de Aceitação

- configuração avançada de DB não fica mais inconsistente com os templates
- `new` e `doctor --fix` usam os mesmos placeholders de forma coerente

## Validação

1. rodar `bun test`
2. rodar `bun x tsc --noEmit`
3. validar manualmente render de arquivos gerados com DB customizado
