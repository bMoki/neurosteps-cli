# Plano — Núcleo + adapters (plugin browser)

Glossário: [CONTEXT.md](../../../CONTEXT.md)

Objetivo: separar o `ns` em **núcleo** (o que ele sabe fazer) e **adapters** (como alguém aciona e vê o resultado), para que uma interface browser possa dirigir o CLI com o mesmo poder que o terminal.

## Como usar estes arquivos

Cada arquivo é uma unidade fechada, feita para ser executada numa janela nova, sem depender do contexto das outras. A ordem importa: `01` antes de `02`, `02` antes de `03`.

| Arquivo | Escopo | Depende de |
|---|---|---|
| [01-contratos-do-nucleo.md](01-contratos-do-nucleo.md) | tipos e diretório `src/core/`; nenhuma mudança de comportamento | — |
| [02-operacao-status.md](02-operacao-status.md) | migra `status` | 01 |
| [03-operacao-new.md](03-operacao-new.md) | migra `new` | 01 |
| [04-operacao-start.md](04-operacao-start.md) | migra `start` + `prepare` | 01 |
| [05-plugin-browser.md](05-plugin-browser.md) | o plugin em si | 02, 03, 04 |
| [99-pendencias.md](99-pendencias.md) | o que ficou de fora, com motivo | — |

Operações migradas e não-migradas **convivem**. O CLI continua funcionando em todos os pontos do caminho.

## Decisões que sustentam o plano

1. **Núcleo + adapters.** O terminal deixa de ser *o* CLI e vira *um* adapter. Uma interface browser é outro adapter da mesma capacidade.
2. **Vocabulário.** Núcleo / Adapter (dirige o núcleo) / Hook (o núcleo chama) / Plugin (unidade instalável, empacota adapters e/ou hooks). A interface browser é um plugin que fornece um adapter.
3. **Operação = `run(input, ctx) => Promise<Result>`.** O `ctx` carrega `emit` (progresso) e `ask` (pergunta). O terminal implementa com ora/inquirer; o browser com websocket/modal.
4. **Decisões do usuário.** Decisão conhecida antes de começar vira **campo de input** (`--force` é o jeito do terminal preencher). Decisão descoberta no meio usa `ctx.ask`, e cada pergunta declara `whenUnavailable: "abort" | "default"`. **O núcleo nunca lê `process.stdout.isTTY`.**
5. **Serviços.** O núcleo devolve o **plano de serviços** e não executa nada; quem executa é o adapter. Mas **serviço não pertence a quem o iniciou**: a identidade é a **porta**, e sair de um adapter nunca encerra um serviço — vale para fechar a aba do browser e para fechar a janela do terminal. Cada serviço roda numa **sessão tmux destacada** (preserva o console interativo do `quarkus:dev`/vite, que `nohup` mataria), com a saída num arquivo de log de caminho ditado pelo núcleo. A janela do Terminal.app passa a rodar `tmux attach` — vira uma vista, igual à aba do browser.
6. **Fronteira.** O núcleo é uma **biblioteca importável**. O plugin é o dono do seu próprio servidor. `ns serve` e protocolos JSON, se existirem um dia, são adapters — não features do núcleo.
7. **Superfície pública.** O contrato é o conjunto de **operações que hoje são comandos `ns`**. `lib/docker`, `lib/git`, `lib/ports` continuam internos e são promovidos caso a caso.
8. **Distribuição.** Plugin de adapter é um **programa próprio** que depende do pacote do núcleo. O binário `ns` não carrega código externo em runtime.
9. **Falhas.** Categorias fechadas de erro (`nao-encontrado`, `conflito`, `pre-condicao`, `ferramenta-externa`, `cancelado`). Nada de `process.exit` dentro do núcleo.
10. **Eventos.** Genéricos, iguais para toda operação. Regra: **evento é para exibir, resultado é para consumir.** Dado que importa sai tipado no resultado, nunca só no evento.
11. **Ordem.** Fatia vertical: `status`, `new`, `start` levadas de ponta a ponta até aparecerem no browser.

## Estado inicial (medido em 2026-08-05)

- 18 arquivos em `src/actions/`, 16 deles importam `lib/logger` — imprimem em vez de retornar.
- **33 `process.exit(1)`** dentro de actions. `add.ts` sozinho tem 16.
- Só 2 classes de erro no projeto: `BranchNotFoundError`, `BranchShutdownNotFoundError`.
- `--json` existe em 3 pontos: `status`, `db snapshots`, `config list`.
- `status` **não tem action**: a lógica vive em `src/commands/status.ts`.
- `prepare` e `start` são a mesma operação, exceto pelo `spawnTerminal` no fim.
- Build: `bun build --compile src/index.ts --outfile dist/ns` → binário único, sem `node_modules` ao lado.
