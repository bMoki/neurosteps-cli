# 01 — Contratos do núcleo

Pré-requisito de tudo. **Nenhuma mudança de comportamento**: só cria tipos e um diretório novo. O CLI continua idêntico ao rodar.

Referência: [00-visao-geral.md](00-visao-geral.md) · decisões 3, 4, 9, 10.

## Diretório novo

```
src/core/
├── index.ts        # ÚNICA coisa que um plugin importa
├── context.ts      # NsContext, eventos, perguntas
├── errors.ts       # NsError + categorias
└── operations/     # (vazio por enquanto; preenchido em 02, 03, 04)
```

Regra que passa a valer: **nada dentro de `src/core/` importa `lib/logger`, `@inquirer/prompts` ou chama `process.exit`.** Essa é a única regra estrutural do plano; se ela for respeitada, o resto se resolve.

## `src/core/errors.ts`

```ts
export type NsErrorCategory =
  | "nao-encontrado"      // branch, snapshot, worktree inexistente
  | "conflito"            // já existe, porta ocupada
  | "pre-condicao"        // docker parado, CLI não configurado, repo ausente
  | "ferramenta-externa"  // git/docker/mvn/npm retornou erro
  | "cancelado";          // usuário respondeu não

export interface NsErrorOptions {
  hint?: string;   // sugestão acionável para o usuário
  cause?: unknown; // erro original, para --debug
}

export class NsError extends Error {
  readonly category: NsErrorCategory;
  readonly hint?: string;

  constructor(category: NsErrorCategory, message: string, options: NsErrorOptions = {}) { ... }
}
```

Helpers curtos por categoria são bem-vindos (`naoEncontrado(msg, hint?)` etc.) — o volume de call sites em 03 justifica.

## `src/core/context.ts`

```ts
export interface NsProgressEvent {
  step: string;     // id estável, ex.: "database:start" — para o adapter correlacionar
  label: string;    // texto pronto para humano, ex.: "Iniciando PostgreSQL..."
  index?: number;   // opcional: passo atual
  total?: number;   // opcional: total de passos
}

export interface NsQuestion {
  id: string;                              // ex.: "start.install-deps.frontend"
  message: string;
  default: boolean;
  whenUnavailable: "abort" | "default";    // o que fazer quando não há quem responda
}

export interface NsContext {
  emit(event: NsProgressEvent): void;
  ask(question: NsQuestion): Promise<boolean>;
}
```

**`ask` nunca rejeita por falta de interatividade.** Quem não sabe perguntar é a implementação do `ctx`, e é ela quem aplica o `whenUnavailable`:

- `"default"` → resolve com `question.default`;
- `"abort"` → lança `NsError("cancelado", ...)`.

É isso que garante a decisão 4: o núcleo só declara a política e nunca inspeciona o ambiente.

## Contextos prontos

**`createSilentContext(): NsContext`** — em `src/core/context.ts`. Descarta eventos e aplica `whenUnavailable`. Serve para testes e para qualquer adapter não-interativo. É o comportamento correto de `--no-input`.

**`createTerminalContext(spinner): NsContext`** — **fora** do core, em `src/lib/terminal-context.ts` (é adapter). `emit` → `spinner.text = event.label`; `ask` → `confirm()` de `lib/prompt.ts`, respeitando `isNoInputEnabled()` e `process.stdin.isTTY`; quando não pode perguntar, aplica `whenUnavailable`.

## `src/core/index.ts`

Barrel com o que é público. Por enquanto só os tipos acima. Cada arquivo seguinte (02, 03, 04) acrescenta a sua operação aqui.

Comentário no topo do arquivo, para não esquecer a decisão 7:

```ts
// Superfície pública do núcleo do ns.
// Só entra aqui o que um plugin pode usar e que nos comprometemos a manter.
// Bibliotecas internas (docker, git, ports, templates) NÃO entram — são promovidas caso a caso.
```

## Tradução de erro no adapter terminal

Em `src/index.ts`, no `main().catch`, antes do tratamento genérico: se for `NsError`, imprimir `error(err.message)` e, havendo `hint`, `hint(err.hint)`.

**Exit code continua 1 para todas as categorias** — preservar o comportamento atual. Diferenciar exit code por categoria é uma mudança visível para scripts e está registrada em [99-pendencias.md](99-pendencias.md).

## Verificação

- `bun test` passa sem alteração (nada foi ligado ainda).
- `rg "process.exit|lib/logger|@inquirer" src/core/` não retorna nada.
