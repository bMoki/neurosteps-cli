# Fase 2: UX de Bootstrap e Base Dir Vazio

## Objetivo

Melhorar o comportamento do `init` quando a máquina está limpa e a pasta base ainda não existe ou está vazia.

## Problemas que Esta Fase Resolve

- base dir inexistente vira silêncio
- usuário não sabe se falta repo, se o path está errado, ou se o bootstrap local foi suficiente
- resumo final ainda sugere próximos passos sem qualificar dependências externas

## Mudanças

1. Explicitar estado do base dir no wizard

- se não existir: avisar claramente
- se existir e estiver vazio: informar isso claramente
- não tratar esses casos como erro fatal do `init`

2. Melhorar saída da etapa de autodetecção

- caso nenhum repo seja detectado:
  - mostrar mensagem específica para pasta vazia
  - mostrar mensagem específica para pasta inexistente
  - mostrar mensagem específica para pasta com conteúdo mas sem repos identificados

3. Melhorar resumo final do `init`

Dividir em duas seções:

- `Pronto agora`
  - config salva
  - diretórios criados
  - templates instalados
- `Ainda necessário`
  - repos locais
  - Docker
  - seed volume
  - portless

4. Revisar próximos passos

- não sugerir imediatamente `ns new <branch>` como se o ambiente já estivesse operacional
- sugerir passos condicionais, ex.:
  - clonar/configurar repos
  - revisar paths detectados
  - depois executar `ns new <branch>`

## Ordem Interna

1. refinar checks do base dir
2. ajustar mensagens de detecção
3. reestruturar resumo final
4. atualizar testes/documentação

## Arquivos Esperados

- `src/actions/init.ts`
- possivelmente `src/lib/logger.ts` se faltar helper adequado
- testes do `init`

## Impactos

### Código

- muda UX, não o contrato central de configuração

### Compatibilidade

- baixo risco
- sem impacto material nos outros comandos

### Testes

- adicionar cenários de base dir inexistente
- adicionar cenários de base dir vazio
- validar mensagens finais do resumo

## Critério de Aceitação

- first-run em pasta inexistente é compreensível
- first-run em pasta vazia é compreensível
- o resumo final diferencia bootstrap local de dependências externas

## Validação

1. rodar `bun test`
2. rodar `bun x tsc --noEmit`
3. simular manualmente base dir inexistente e base dir vazia
