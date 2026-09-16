# 03 — Operação `new`

Depende de [01-contratos-do-nucleo.md](01-contratos-do-nucleo.md).

A operação mais longa do CLI (400 linhas em `src/actions/new.ts`) e a única que dispara **hooks** — por isso ela está na fatia: exercita as duas direções de extensão de uma vez.

Prova os mecanismos: **progresso**, **erros por categoria**, **hooks**, e um **resultado gordo** (paths, portas, URLs).

## Escopo — o que NÃO fazer aqui

`newAction` faz git, portas, templates, VS Code, IntelliJ, DataGrip, run configurations, hooks e seed do banco. **Não é hora de quebrar isso em módulos.** O trabalho desta etapa é só:

1. tirar a impressão de dentro,
2. trocar `throw new Error` por `NsError` com categoria,
3. trocar `s.text = ...` por `ctx.emit`,
4. devolver um resultado.

A sequência interna fica exatamente como está. Refatorar `new` é assunto separado — está em [99-pendencias.md](99-pendencias.md).

## `src/core/operations/new.ts` (novo)

```ts
export interface NewInput {
  branch: string;
  baseBranch: string;
  withManager: boolean;
}

export interface NewResult {
  branch: string;
  slug: string;
  paths: { root: string; backend: string; frontend: string; docs: string; manager?: string };
  ports: { db: number; backend: number; backendDebug: number; frontend: number; manager?: number };
  urls:  { frontend: string; backend: string; swagger: string; manager?: string };
  db:    { volume: string; container: string; seededFrom: string | null };
  dataSourceUuid: string;
}

export async function runNew(input: NewInput, ctx: NsContext): Promise<NewResult>
```

`NewDeps` (`new.ts:37`) continua existindo do jeito que está — é injeção para teste, não faz parte da superfície pública. Passa a ser um terceiro parâmetro opcional.

## Erros — mapa de `throw new Error` → `NsError`

| Hoje (`actions/new.ts`) | Vira |
|---|---|
| `Repositório <X> não encontrado em <path>` (L104, L110) | `pre-condicao`, hint apontando `NS_BASE_DIR` / `ns doctor` |
| `Branch base '<ref>' não existe em <repo>` (L118, L123) | `nao-encontrado` |
| `Worktree já existe: <path>` (L138) | `conflito`, hint sugerindo `ns rm <branch>` |

Falha de `git`/`docker` vinda de `execChecked` deve ser embrulhada como `ferramenta-externa`, preservando a mensagem original em `cause`. Um único `try/catch` em volta dos blocos de shell resolve — não precisa ser call site por call site.

Nenhum `s.stop()` antes de lançar: quem cuida do spinner é o adapter.

## Progresso — `s.text` → `ctx.emit`

Os pontos que hoje mexem no spinner viram eventos com `step` estável:

| `step` | `label` |
|---|---|
| `new:validate` | `Validando repositórios...` |
| `new:repo` | `Configurando <Backend\|Frontend\|Docs\|Manager>...` |
| `new:ports` | `Alocando portas...` |
| `new:templates` | `Gerando arquivos de configuração...` |
| `new:ide` | `Configurando IDE...` |
| `new:hooks` | `Rodando hooks...` |
| `new:seed` | `Seedando volume do banco...` |

`index`/`total` são opcionais; `new` tem passos suficientes para valer a pena preencher.

## Resultado — o que sai da impressão

Todo o bloco `section("Paths") / detail(...) / section("Portas") / ...` (`new.ts:375-396`) **sai do núcleo** e vira campo de `NewResult`. As URLs continuam sendo montadas no núcleo (são derivadas de slug + `PORTLESS_PROXY_PORT`, é regra de domínio), só não são impressas.

O bloco `section("Próximos passos")` com os `hint("1. ns prepare ...")` é **texto do adapter terminal** — sugere comandos de terminal. Não vai para o núcleo nem para o resultado.

`markTouched(branch, "new")` continua dentro do núcleo: é estado do domínio, não apresentação.

## Hooks

`runHooks("new:after", ...)` (`new.ts:321`) **fica dentro do núcleo**, inalterado. Hooks são extensão de dentro para fora (decisão 2) — o núcleo é o dono desse ponto.

Mas repare: `NewAfterHookContext` (`src/lib/hooks.ts:8`) agora é **superfície pública de fato**, mesmo sem plugins de terceiro. Ao mover `new` para o core, mover também `lib/hooks.ts` → `src/core/hooks.ts` e exportar `HookEvent`, `HookName` e `NewAfterHookContext` do barrel. Os dois hooks embutidos (`intellij:*`) continuam em `src/hooks/`.

Carregar hooks de terceiro **não** é escopo — ver [99-pendencias.md](99-pendencias.md).

## `src/commands/branch.ts`

O comando `new` passa a: criar spinner → `createTerminalContext(spinner)` → `runNew(input, ctx)` → imprimir `NewResult` com `section`/`detail` (o mesmo texto de hoje) → imprimir os próximos passos.

O texto impresso deve ficar **idêntico** ao atual. É o critério de aceite mais fácil de verificar.

## Testes

`src/__tests__/actions/new.test.ts` e `new-paths.test.ts` já usam `NewDeps`. Adaptar para chamar `runNew` com `createSilentContext()` e passar a verificar `NewResult` em vez de efeito colateral — os testes ficam mais curtos, não mais longos.

## Verificação

- `ns new <branch> <base>` produz a mesma saída e os mesmos arquivos de antes.
- Os três erros da tabela acima continuam com exit code 1 e a mesma mensagem.
- Hook `intellij:configure-db` continua rodando (checar `dataSources.xml` na worktree criada).
