# 02 — Operação `status`

Depende de [01-contratos-do-nucleo.md](01-contratos-do-nucleo.md).

A migração mais barata do plano: `status` **não tem action**. A lógica já está isolada em `buildRows()` dentro de `src/commands/status.ts:69`, e ela já devolve um resultado tipado (`CompactStatusRow[]`). Na prática isto é mudar de lugar e completar o resultado.

Prova o mecanismo: **resultado tipado**. Não exercita `ask`, progresso nem erro complexo — de propósito.

## `src/core/operations/status.ts` (novo)

```ts
export interface StatusInput {
  branch?: string;   // ausente = todas as branches
}

export interface BranchStatus {
  branch: string;
  slug: string;
  path: string;                       // WORKTREES_DIR/<branch>
  ports: {
    db: number; backend: number; frontend: number;
    manager?: number; reportServer?: number;
  };
  services: {
    db: boolean;
    backend: boolean;
    frontend: boolean;
    manager: boolean | null;          // null = não existe nesta branch
    reportServer: boolean | null;
  };
  aliases: {                          // alias Portless esperado de cada serviço
    backend: string; frontend: string;
    manager?: string; reportServer?: string;
  };
  flags: string[];
  stale: boolean;
  lastCommitAt: string | null;
  lastCliUsedAt: string | null;
}

export interface StatusResult {
  branches: BranchStatus[];
}

export async function runStatus(input: StatusInput, ctx: NsContext): Promise<StatusResult>
```

Movimento: `buildRows()` sai de `commands/status.ts` e vira `runStatus`, acrescentando os campos que hoje só `showBranchStatus` calcula (path, portas, nomes de alias). Hoje há **duas leituras diferentes** do mesmo estado — a compacta e a detalhada; o resultado passa a ser um só, e cada renderizador escolhe o que mostra.

- `input.branch` inexistente → `NsError("nao-encontrado", "Worktree não encontrada para '<branch>'")`. Substitui o `error(...) + process.exitCode = 1` de `commands/status.ts:163`.
- Sem branch nenhuma no workspace → **não** é erro: `{ branches: [] }`.
- `ctx.emit` é opcional aqui; a operação é rápida. Se emitir, um evento por branch lida (`step: "status:branch"`), útil quando há muitas branches.

## `src/commands/status.ts`

Vira só apresentação. Os quatro renderizadores atuais continuam existindo e passam a consumir `StatusResult`:

| Renderizador | Muda? |
|---|---|
| tabela compacta | consome `result.branches`; mantém `sortCompactStatusRows` e `formatCompactBranchName` |
| `--plain` | idem |
| `--json` | **saída byte-idêntica à de hoje** (ver abaixo) |
| detalhe de uma branch | consome `result.branches[0]` em vez de reler `readWorkspaceEnv` |

`sortCompactStatusRows`, `isCompactStatusRowFullyOff` e `formatCompactBranchName` são **regras de apresentação** — ficam no adapter, não no núcleo.

⚠️ **`--json` já é contrato público.** As chaves atuais (`db`, `backend`, `frontend`, `reportServer`, `stale`, `lastCommitAt`, `lastCliUsedAt`) e o formato "objeto quando tem branch, array quando não tem" precisam continuar iguais. O mapeamento de `BranchStatus` para esse formato fica no comando, não no núcleo — o núcleo tem a forma que faz sentido para ele, o adapter tem a forma que já foi prometida.

## `src/core/index.ts`

Exportar `runStatus`, `StatusInput`, `StatusResult`, `BranchStatus`.

## Testes

Novo `src/__tests__/core/status.test.ts`: `runStatus` com `createSilentContext()`, verificando resultado — sem capturar stdout.

Os testes atuais de `commands/status.ts` (ordenação, truncamento de nome) continuam válidos e não devem mudar.

## Verificação

- `ns status`, `ns status <branch>`, `ns status -a`, `--plain` e `--json` produzem saída idêntica à de antes. Vale guardar a saída antes de começar e comparar depois.
- `ns status branch-que-nao-existe` continua com exit code 1.
