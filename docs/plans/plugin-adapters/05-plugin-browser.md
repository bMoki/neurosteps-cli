# 05 — Plugin browser

Depende de [02](02-operacao-status.md), [03](03-operacao-new.md) e [04](04-operacao-start.md).

O caso de uso motivador. Aqui o núcleo já existe e o trabalho é escrever o **primeiro adapter que não é o terminal**.

## Fronteira de pacote

O núcleo precisa ser **importável**, e hoje o `ns` é um binário compilado (`bun build --compile`) sem `node_modules` ao lado. Um binário não se importa.

Menor caminho que funciona:

1. Adicionar em `package.json` um export do núcleo:
   ```json
   "exports": { "./core": "./src/core/index.ts" }
   ```
   Bun consome TypeScript direto — não precisa de build separado para o núcleo.
2. `bun link` no repositório do CLI; `bun link ns-cli` no repositório do plugin.
3. O plugin importa `import { runStatus, runNew, runPrepare } from "ns-cli/core"`.

`dist/ns` continua sendo compilado igual — o adapter terminal não muda de forma.

Publicar em registry é decisão separada, ver [99-pendencias.md](99-pendencias.md).

## Onde o plugin mora

**Repositório próprio**, fora deste. O núcleo não deve saber que ele existe (decisão 6). Nome sugerido: `ns-browser`.

```
ns-browser/
├── package.json          # depende de ns-cli (via bun link)
├── src/
│   ├── server.ts         # HTTP + websocket
│   ├── context.ts        # NsContext do browser
│   └── operations.ts     # registro das operações expostas
└── web/                  # a página
```

## O `NsContext` do browser

É a peça central e a razão de todo o resto do plano:

```ts
function createBrowserContext(socket: ServerWebSocket): NsContext {
  return {
    emit(event) {
      socket.send(JSON.stringify({ tipo: "progresso", ...event }));
    },
    async ask(question) {
      socket.send(JSON.stringify({ tipo: "pergunta", ...question }));
      return await aguardarResposta(question.id);   // resolve quando a página responder
    },
  };
}
```

A página desenha **um** componente de progresso e **um** modal de pergunta, e eles servem para as três operações — e para qualquer operação futura, sem tocar no plugin (decisão 10).

Cuidados: timeout em `ask` (se a aba fechar, ninguém responde nunca — cair para `whenUnavailable`); e uma operação por branch de cada vez, senão dois `emit` concorrentes se misturam na mesma tela.

## Executando o plano de serviços

`runPrepare` devolve `services: ServicePlan[]` e não executa nada. O plugin executa — **mas não vira dono**.

A regra vem da etapa [04](04-operacao-start.md): serviço não pertence a quem o iniciou. Fechar o browser não pode derrubar o backend.

O plugin **não faz `Bun.spawn` do serviço**. Ele chama o mesmo helper que o adapter terminal usa (`startService(plan)` da etapa [04](04-operacao-start.md)), que sobe uma sessão tmux destacada. Nenhum descritor do plugin fica no caminho: se o plugin morrer, o serviço nem percebe.

Três capacidades caem no colo por causa disso:

**Log** — o plugin faz *tail* do `logFile` e transmite para a página. Não captura stdout de ninguém. Efeito colateral bom: a página mostra o log de um serviço que subiu pelo terminal, antes de o plugin existir. Lembrar de tratar os códigos ANSI que o `pipe-pane` grava.

**Interação** — `tmux send-keys -t <sessao> r` manda uma tecla para o console do quarkus. "Reiniciar backend" vira botão na página, sem parar processo nenhum. Isso não existe em lugar algum hoje.

**Controle** — parar ou reiniciar um serviço isolado usa a identidade canônica, a **porta** (`lsof -ti :<porta>`), mais `tmux kill-session`. O plugin guardou o `ServicePlan`, então subir de novo é imediato.

`ns stop` no terminal derruba tudo sem saber que o plugin existe, e vice-versa.

## Segurança — não pular

Um servidor HTTP em `localhost` é alcançável por **qualquer página aberta no navegador**. Sem proteção, um site qualquer pode disparar `ns rm --purge` na sua máquina via `fetch`.

Mínimo aceitável:

- token gerado a cada boot, exigido em toda requisição (a página o recebe na URL de abertura);
- `Origin` verificado no upgrade do websocket;
- bind em `127.0.0.1`, nunca `0.0.0.0`.

## Escopo da primeira versão

| Tela | Operação | Mecanismo que prova |
|---|---|---|
| Painel de branches | `runStatus` | resultado tipado |
| Criar branch | `runNew` | progresso longo + erros por categoria |
| Iniciar branch | `runPrepare` + executar plano | `ctx.ask` + plano de serviços + logs |

Se essas três funcionarem, o contrato está validado e as outras 13 operações são repetição.

## Critério de sucesso

Criar uma branch, subir os serviços e ver o backend responder — **sem abrir o terminal uma vez**.
