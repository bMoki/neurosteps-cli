# 04 — Operação `start` (e `prepare`)

Depende de [01-contratos-do-nucleo.md](01-contratos-do-nucleo.md).

A operação difícil, e por isso a que fecha a fatia: se `start` couber no contrato, o resto cabe. Prova **`ctx.ask`**, **plano de serviços** e **progresso em operação longa**.

## O achado que define esta etapa

`prepareAction` e `startAction` são a **mesma operação**, exceto pelo último passo:

| | `prepare` | `start` |
|---|---|---|
| `setupBranchRuntime` (portas, DB, portless) | ✅ | ✅ |
| instalar deps faltando | ✅ sempre, calado | ✅ perguntando (`start.ts:79`) |
| abrir Terminal.app com os serviços | ❌ | ✅ |

Pela decisão 5 (o núcleo devolve o plano e não executa), o terceiro passo sai do núcleo. Sobra uma diferença só: **como tratar dependência faltando** — e pela decisão 4 isso é um campo de input.

**Portanto: uma única operação de núcleo.** `ns prepare` e `ns start` viram dois comandos do adapter terminal sobre a mesma operação, diferindo em um input e em executar ou não o plano.

**Decidido: uma operação só, `runPrepare`.** O comportamento externo dos dois comandos é preservado — ambos continuam existindo, com a mesma saída. O ganho concreto é matar a duplicação: hoje o bloco de instalação de dependências está copiado entre `prepare.ts:36-77` e `start.ts:74-150`, ~75 linhas quase idênticas que já divergiram uma vez (é daí que veio a incoerência "um instala calado, outro pergunta").

Ficam dois nomes no glossário (`Preparar`, `Iniciar`) e uma função no código. É intencional: a distinção é de domínio, a unificação é de implementação.

## `src/core/operations/prepare.ts` (novo)

```ts
export interface PrepareInput {
  branch: string;
  withManager?: boolean;        // default: detecta com hasManager()
  withReportServer?: boolean;   // default: detecta com hasReportServer()
  installMissingDeps: "always" | "ask" | "never";
}

export interface ServicePlan {
  id: "backend" | "frontend" | "manager" | "report-server";
  label: string;                        // "Backend"
  cwd: string;
  env: Record<string, string>;
  command: string;                      // "mvn -pl <core> quarkus:dev"
  port: number;                         // identidade do serviço (ver abaixo)
  logFile: string;                      // ~/.local/state/ns/<branch>/<id>.log
}

export interface PrepareResult {
  branch: string;
  ports: { db: number; backend: number; frontend: number; manager?: number; reportServer?: number };
  urls:  { backend: string; frontend: string; manager?: string; reportServer?: string };
  services: ServicePlan[];
  depsInstalled: string[];              // ids que tiveram deps instaladas nesta execução
  depsMissing: string[];                // ids que continuam sem deps (usuário disse não)
}

export async function runPrepare(input: PrepareInput, ctx: NsContext): Promise<PrepareResult>
```

`buildStartServices()` (`start.ts:203`) migra praticamente intacta e passa a produzir `ServicePlan[]` — ela já devolvia quase essa forma. `BranchSetupDeps` continua como está, como terceiro parâmetro opcional.

## Regra: serviço não pertence a quem o iniciou

Fechar o browser não pode derrubar o backend, e voltar para o terminal não pode exigir subir tudo de novo. Isso já vale hoje: `stopBranchProcesses` (`branch-shutdown.ts:98`) resolve serviço por `lsof -ti :<porta>` e mata por PID — **a identidade de um serviço é a porta**, e nenhum adapter segura handle de nada.

Isso vale **também para o terminal**. Hoje `spawnTerminal` coloca o serviço dentro da janela do Terminal.app, e fechar a janela manda SIGHUP e mata. Sob o princípio, fechar a janela não pode ser diferente de fechar a aba do browser.

Destacar com `nohup` resolveria, mas mataria o console interativo do `quarkus:dev` e do vite, que lê stdin (`r`, `s`, `h`, runner de testes). Por isso: **cada serviço roda numa sessão tmux destacada**, uma por serviço. TTY preservado, console vivo, e a janela do terminal vira uma *vista* do serviço.

### Mecânica

Nome da sessão: `ns-<BRANCH_SLUG>-<id>` — usar o slug, porque nome de branch tem `/` e tmux não aceita. `BRANCH_SLUG` já existe em `.workspace.env`.

```
tmux new-session -d -s ns-<slug>-backend -c <cwd> "<shellCommand>"
tmux set-option -t ns-<slug>-backend remain-on-exit on
tmux pipe-pane -t ns-<slug>-backend -o "cat >> <logFile>"
```

`<shellCommand>` é o que `formatShellCommand(cwd, env, command)` já produz hoje (`cd X && export A=B && cmd`) — reaproveitado inteiro. Passar env por `tmux -e` exigiria tmux 3.2+; pelo shell funciona em qualquer versão.

`remain-on-exit on` mantém o painel vivo quando o serviço crasha, para a mensagem de erro não sumir junto.

Adicionar em `src/lib/config.ts`:

```ts
export const NS_STATE_DIR = join(homedir(), ".local", "state", "ns");
export function resolveServiceLogFile(branch: string, id: string): string
export function resolveServiceSession(slug: string, id: string): string
```

O diretório é criado por `runPrepare`. O log é truncado a cada start — é da execução atual, não histórico acumulado.

⚠️ O `pipe-pane` captura a saída do painel **com códigos ANSI**. Para o terminal tanto faz; o adapter browser precisa interpretar ou remover na renderização.

### Onde isso mora

Subir a sessão é do **adapter**, não do núcleo — `runPrepare` continua só devolvendo o plano. Mas o nome da sessão e o caminho do log vêm do núcleo, senão os adapters não se encontram. Um helper compartilhado (`src/lib/services.ts`, fora do core) com `startService(plan)` / `stopService(plan)` evita que terminal e browser implementem a mesma sequência tmux de formas sutilmente diferentes.

### `ns stop`

`stopBranchProcesses` (`branch-shutdown.ts:98`) ganha um passo: `tmux kill-session -t <nome>` para cada serviço, **antes** do `lsof`/`kill` por porta. O kill por porta continua como rede de segurança, para serviço que tenha subido por fora do tmux. Sem isso, matar o processo deixaria a sessão órfã com um shell morto.

## Dependências faltando

Os três blocos `if (process.stdout.isTTY)` (`start.ts:78, 104, 131`) somem. No lugar, por app:

```ts
const deveInstalar =
  input.installMissingDeps === "always" ? true :
  input.installMissingDeps === "never"  ? false :
  await ctx.ask({
    id: `prepare.install-deps.${id}`,
    message: `Instalar dependências do ${label} agora?`,
    default: true,
    whenUnavailable: "default",
  });
```

`whenUnavailable: "default"` com `default: true` mantém o comportamento de `prepare` (instala) para quem não pode perguntar. Repare que isto **corrige** de quebra a incoerência atual: hoje `prepare` instala calado e `start` sem TTY **pula** a instalação e só imprime um `hint`.

`npm ci` com fallback para `npm install` (e `bun install` no report-server) continua igual. Falha de instalação **não** aborta: registra em `depsMissing` e segue — é o comportamento de hoje, e o adapter avisa.

## Progresso

`setupBranchRuntime` já tem `onStep` com uma união tipada (`BranchSetupStep`). Ligar direto: cada `onStep` vira um `ctx.emit`, e o mapa de rótulos que hoje está no `startAction` (`start.ts:63-66`) passa a viver na operação, já que `label` é texto pronto.

Acrescentar `prepare:deps:<id>` para a fase de instalação, que hoje só aparece como `s.text`.

## Erros

- `BranchNotFoundError` (`branch-setup.ts:55`) → `NsError("nao-encontrado")`. Manter a classe como subclasse de `NsError` para não quebrar os `instanceof` existentes.
- Docker indisponível / falha ao subir o container → `pre-condicao` ou `ferramenta-externa`.

## Adapter terminal — `src/commands/dev.ts`

**`ns prepare <branch>`**
`runPrepare({ ..., installMissingDeps: "always" })` → imprime resumo. Ignora `result.services`.

**`ns start <branch>`**
`runPrepare({ ..., installMissingDeps: "ask" })` → para cada `result.services`, sobe a sessão tmux e abre a janela atachada → imprime URLs.

`spawnTerminal` **continua existindo e quase não muda** — o que muda é o que ele roda dentro da janela:

```ts
// antes: o serviço
await spawnTerminal(cwd, env, command);
// depois: uma vista do serviço
await spawnTerminal(process.cwd(), {}, `tmux attach -t ${session}`);
```

Você continua com quatro janelas, uma por serviço, cada uma mostrando o log rolando e aceitando as teclas do console do quarkus. O que muda: **fechar a janela desatacha em vez de matar.** Parar passa a ser sempre `ns stop`.

⚠️ Pegadinha a documentar no README: quem fechava a janela para derrubar o serviço vai estranhar. Ctrl-C continua funcionando normalmente (é um TTY de verdade e o sinal chega ao processo).

**Fallback** — se `tmux` não estiver instalado, `runPrepare` não falha: o adapter avisa e cai no comportamento antigo (serviço dentro da janela, sem sobrevivência). `ns doctor` passa a checar tmux.

Toda a lógica de fallback de Terminal.app (`start.ts:159-187`) **fica no adapter**, onde sempre pertenceu: se `spawnTerminal` falhar, imprimir `formatShellCommand(...)` de cada serviço restante para o usuário rodar na mão. Essa é a mesma informação que o plugin browser vai consumir — só que como dado.

`--no-manager` / `--no-report-server` viram `withManager: false` / `withReportServer: false`. `--ai` continua no adapter (abre app de IDE/AI; não é domínio).

## Testes

`src/__tests__/actions/start.test.ts` e `prepare.test.ts` passam a chamar `runPrepare` com um `ctx` de teste cujo `ask` devolve valor fixo — bem mais direto que simular TTY.

Teste novo que vale a pena: `installMissingDeps: "ask"` + `ctx` que responde `false` → `depsMissing` contém o app e nenhum `npm install` foi chamado.

## Verificação

- `ns prepare <branch>` e `ns start <branch>` com a mesma saída e comportamento de antes.
- `ns start <branch>` continua abrindo as janelas do Terminal.app.
- `ns start --no-input <branch>` numa branch sem `node_modules`: **instala** as dependências (antes, pulava). É a única mudança de comportamento intencional da etapa.
