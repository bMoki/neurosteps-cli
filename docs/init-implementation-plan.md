# Plano de Implementação do `init`

## Objetivo

Evoluir o comando `init` para funcionar melhor em ambiente 100% limpo, com foco em:

- impedir configuração inválida já no wizard
- reduzir suposições implícitas sobre repos e paths
- alinhar bootstrap local com a configuração coletada
- comunicar melhor o que fica pronto e o que ainda depende do ambiente externo

## Estratégia

Executar em fases pequenas, com baixo acoplamento entre si.

Ordem recomendada:

1. Fase 1: validação do wizard e modelo de configuração
2. Fase 2: UX de bootstrap e base dir vazio
3. Fase 3: alinhamento entre templates embutidos e configuração real
4. Fase 4: readiness externa e fechamento de pendências

## Por Que Esta Ordem

1. A Fase 1 evita o pior estado possível: `init` aparentemente bem-sucedido com config inválida.
2. A Fase 2 melhora a experiência de first-run sem mexer no comportamento funcional de `new`/`doctor`.
3. A Fase 3 mexe em templates e pode impactar `new`, `doctor` e `template`, então vem depois da base do wizard.
4. A Fase 4 fecha o fluxo com diagnóstico e mensagens de dependências externas.

## Mapa de Arquivos Mais Afetados

- `src/actions/init.ts`
- `src/lib/env.ts`
- `src/lib/bootstrap.ts`
- `src/commands/init.ts`
- `src/commands/config.ts`
- `src/actions/new.ts`
- `src/actions/doctor.ts`
- `src/actions/template.ts`
- `src/__tests__/...`
- `.env.example`

## Dependências Entre Fases

- Fase 2 depende da Fase 1 para trabalhar com um modelo de config já consistente.
- Fase 3 depende da Fase 1 se houver inclusão de `NS_FRONTEND_REPO_NAME` ou mudança no schema.
- Fase 4 depende da Fase 2 para não duplicar trabalho de UX/mensagens.

## Critério de Conclusão

O conjunto completo estará pronto quando:

- `ns init` não permitir salvar obrigatórios vazios
- `ns init` não assumir frontend hardcoded sem deixar isso explícito
- templates embutidos refletirem `NS_DB_*` e demais valores configurados
- o resumo final diferenciar claramente bootstrap local de dependências externas
- testes e build continuarem verdes

## Execução Recomendada

- Execute um arquivo de fase por vez.
- Ao fim de cada fase:
  - rodar `bun test`
  - rodar `bun x tsc --noEmit`
  - rodar build compilado
- Só então seguir para a próxima.

## Arquivos de Fase

- `docs/init-phase-1-validation-and-config.md`
- `docs/init-phase-2-bootstrap-ux.md`
- `docs/init-phase-3-template-alignment.md`
- `docs/init-phase-4-readiness-and-polish.md`
