# 2. Núcleo e adapters, com plugins como programas próprios

Data: 2026-08-06

## Status

Aceito (implementação pendente).

Plano de execução: [docs/plans/plugin-adapters/](../plans/plugin-adapters/00-visao-geral.md)

## Contexto

O `ns` nasceu como um programa de terminal e é hoje uma coisa só: `src/commands/` define comandos do Commander e `src/actions/` contém a lógica. A separação é de arquivos, não de responsabilidade — 16 das 18 actions importam `lib/logger` e **imprimem** em vez de retornar. `startAction` calcula a URL do backend e essa informação só existe como texto colorido no stderr.

Surgiu a intenção de acessar o CLI por uma **interface browser**. A formulação inicial foi "um sistema de plugins onde o CLI expõe tudo, e a interface browser é o primeiro plugin".

Ao desenhar isso, ficou claro que "plugin" estava cobrindo duas extensões que puxam a arquitetura para lados opostos:

- **De dentro para fora**: o CLI executa e chama código de terceiro num ponto de extensão. É o que `src/lib/hooks.ts` já faz — `new:after` configura o IntelliJ. Existe e funciona.
- **De fora para dentro**: algo externo dirige o CLI e consome o resultado. É o que a interface browser precisa, e para isso não há nada.

Uma interface browser não cabe na primeira. Ela precisa de resultado estruturado (hoje é `void`), progresso em streaming (hoje é `s.text` num spinner), e uma forma de responder ao `confirm("Instalar dependências do frontend agora?")` que hoje só um TTY consegue dar. Tratar as duas extensões com um mecanismo só produziria um sistema que não serve bem para nenhuma.

Alguns fatos do código restringiram as escolhas:

- Há **33 `process.exit(1)`** dentro de actions e apenas 2 classes de erro no projeto inteiro.
- O `ns` é distribuído como **binário compilado único** (`bun build --compile`), sem `node_modules` ao lado.
- Serviços iniciados por `ns start` não pertencem ao `ns`: são despachados para o Terminal.app via osascript, o processo morre, e `ns stop` os reencontra por `lsof`. O CLI já é observacional e sem estado.
- `prepare` e `start` são a mesma operação, exceto por abrir terminais no fim.
- `buildStartServices()` já produz o plano de serviços como valor; ele só é usado hoje para imprimir instruções quando o Terminal.app falha.

## Decisão

### 1. Duas camadas, quatro termos

O `ns` passa a ser **núcleo** (o que ele sabe fazer) mais **adapters** (como alguém aciona e vê o resultado). O terminal deixa de ser *o* CLI e vira *um* adapter.

O vocabulário fica em [CONTEXT.md](../../CONTEXT.md): **Núcleo**, **Adapter** (dirige o núcleo, de fora para dentro), **Hook** (o núcleo chama, de dentro para fora), **Plugin** (unidade instalável, que empacota adapters e/ou hooks). "Plugin" descreve distribuição, não papel — a interface browser é um plugin que fornece um adapter.

### 2. Operação = `run(input, ctx) => Promise<Result>`

Toda operação de núcleo recebe um **contexto injetado** com `emit(evento)` e `ask(pergunta)`, e devolve um resultado tipado. O terminal implementa o contexto com ora e inquirer; o browser, com websocket e modal.

A forma foi escolhida por ser o menor delta do que já existe — `setupBranchRuntime(..., { onStep })` e o padrão `Deps` já são exatamente isso — e por sobreviver a uma fronteira de processo, que é onde o adapter browser inevitavelmente vive.

### 3. O núcleo nunca inspeciona o ambiente

Decisão conhecida antes de a operação começar vira **campo de input**; `--force` passa a ser o jeito do adapter terminal preencher esse campo. Decisão descoberta no meio usa `ctx.ask`, e cada pergunta declara `whenUnavailable: "abort" | "default"`.

Quem não sabe perguntar é a implementação do contexto, e é ela quem aplica a política. **O núcleo não lê `process.stdout.isTTY`.** Isso substitui as duas políticas de interatividade incompatíveis que existem hoje (`lib/prompt.ts` aborta sem TTY; `start.ts` pula em silêncio).

### 4. O núcleo devolve o plano de serviços e não o executa

`runPrepare` faz o trabalho de domínio — portas, banco, aliases, dependências — e devolve `services: ServicePlan[]`. Quem executa é o adapter: o terminal despacha para o Terminal.app como sempre; o browser roda como processo filho e transmite os logs.

Consequência direta: o browser segura o plano e consegue reiniciar um serviço isolado sem consultar o núcleo de novo.

Com uma restrição que o adapter **não** pode escolher: **um serviço nunca pertence a quem o iniciou.** Trocar de adapter — fechar o browser, voltar ao terminal — não pode exigir reiniciar nada. Isso já é verdade hoje por acidente feliz: `stopBranchProcesses` (`branch-shutdown.ts:98`) resolve serviço por `lsof -ti :<porta>` e não existe PID file nem supervisor. **A identidade de um serviço é a porta dele**, registrada em `.workspace.env`; o sistema operacional faz o resto. Adapters ficam proibidos de segurar os processos por pipe ou por handle.

A consequência prática recai sobre os **logs**, que hoje não existem fora do scrollback do Terminal.app: um adapter que capture stdout por pipe deixa o processo escrevendo num cano órfão quando morre. Portanto cada serviço escreve num **arquivo de log** cujo caminho é ditado pelo núcleo e viaja no `ServicePlan`. Qualquer adapter acompanha o mesmo arquivo, inclusive de serviço que subiu antes de ele existir. O caminho ser do núcleo é o que garante interoperabilidade — se cada adapter escolhesse o seu, o princípio se perderia.

A regra vale **também para o adapter terminal**, e é aí que ela cobra caro. Hoje `spawnTerminal` despacha o serviço para dentro de uma janela do Terminal.app: fechar a janela manda SIGHUP e mata o serviço. Isso contradiz o princípio tanto quanto fechar o browser mataria — e derrota o objetivo declarado, porque sair do terminal para usar o browser exigiria subir tudo de novo.

Simplesmente destacar o processo (`nohup`, saída em arquivo) resolveria, mas cobra um preço específico: **`mvn quarkus:dev` e o vite têm console interativo** que lê stdin (`r` para restart, `s`, `h`, runner de testes). Sem TTY, esse console morre. Era ele que o vínculo com a janela estava pagando.

Decidimos então rodar **cada serviço numa sessão tmux destacada**, uma por serviço. O TTY é preservado, o console interativo continua funcionando ao reatachar, e a janela do Terminal.app passa a rodar `tmux attach` — ou seja, vira uma **vista** do serviço, exatamente como a aba do browser. Fechar a janela desatacha; não mata. `tmux pipe-pane` alimenta o arquivo de log que qualquer adapter lê, e `tmux send-keys` permite que um adapter interaja com o console de um serviço que ele não iniciou.

O `screen` do sistema foi avaliado e descartado: a versão que o macOS distribui é a 4.00.03, de 2006, cujo `-L` escreve em `screenlog.0` no diretório atual — sujaria os repositórios — e não aceita caminho de log.

Aplicadas as decisões 3 e 4, `prepare` e `start` deixam de diferir: viram **uma operação de núcleo** (`runPrepare`), com `ns prepare` e `ns start` como dois comandos do adapter terminal sobre ela — um ignora o plano de serviços, o outro o executa. Continuam sendo dois termos distintos no glossário; a distinção é de domínio, a unificação é de implementação.

### 5. O núcleo é biblioteca; o plugin é o dono do seu servidor

Uma página web não chama função TypeScript local — entre ela e o núcleo existe obrigatoriamente um processo servidor. Esse servidor é **do plugin**, não do núcleo. O núcleo é exposto como pacote importável (`ns-cli/core`) e não sabe que browsers existem.

Disso decorre que `ns serve` e um eventual protocolo JSON por stdio são **adapters**, não features do núcleo — e podem ser escritos depois, por fora, sem tocar em nada.

Plugin de adapter é um **programa próprio** que depende do pacote do núcleo. O binário `ns` não ganha capacidade de carregar código externo em runtime.

### 6. A superfície pública é o conjunto de operações

O contrato que o núcleo se compromete a manter é **toda operação que hoje é um comando `ns`** — não todo o código. `lib/docker`, `lib/git`, `lib/ports` e `lib/templates` continuam internos e são promovidos caso a caso, quando um plugin real precisar.

Um recorte útil que isso produz: `ns completion` gera script de autocomplete de shell, então é assunto exclusivo do adapter terminal e nunca entra no núcleo.

### 7. Falhas por categoria, eventos genéricos

O núcleo lança `NsError` com uma categoria de um conjunto fechado (`nao-encontrado`, `conflito`, `pre-condicao`, `ferramenta-externa`, `cancelado`) e nunca chama `process.exit`. Cada adapter traduz: o terminal para exit code e texto, o browser para o tipo de UI adequado — mensagem inline, banner com "tentar de novo", ou simplesmente fechar o modal.

Eventos de progresso são **genéricos e iguais para todas as operações**, sob a regra: *evento é para exibir, resultado é para consumir*. Dado que importa sai tipado no resultado, nunca só no evento. Assim a UI browser escreve um renderizador de progresso só, que serve inclusive para operações criadas depois.

## Consequências

**Positivas**

- A interface browser deixa de ser um caso especial: é o segundo adapter de uma capacidade que qualquer outro (MCP, protocolo JSON, `ns serve`) pode usar depois sem mudança no núcleo.
- `process.exit` dentro de biblioteca mataria o servidor do plugin sem responder à requisição; erros tipados eliminam a classe inteira desse problema e melhoram o terminal de quebra.
- Duas incoerências de comportamento somem no caminho: as duas políticas de TTY, e o `prepare` que instala dependências calado enquanto o `start` pergunta.
- O núcleo fica testável sem simular terminal: `createSilentContext()` substitui mock de TTY e captura de stdout.
- A superfície pública é enumerável e cresce sob demanda, uma operação por vez.

**Negativas / trade-offs**

- **Plugin roda no mesmo processo, com acesso total à máquina, e só em TypeScript/Bun.** Aceitável para ferramenta pessoal de desenvolvimento; deixa de ser se um dia houver plugin de terceiro.
- **Um servidor HTTP em `localhost` é alcançável por qualquer página aberta no navegador.** Sem token e verificação de `Origin`, um site qualquer poderia disparar `ns rm --purge`. Passa a ser responsabilidade de cada plugin que sobe servidor — o núcleo não tem como impor.
- **Convivência temporária de dois estilos.** A fatia vertical migra `status`, `new` e `start`; as outras 13 operações continuam imprimindo e chamando `process.exit`. O repositório fica inconsistente por um tempo, de propósito.
- **A fronteira de pacote é nova responsabilidade.** `exports` no `package.json` e `bun link` funcionam enquanto plugin e CLI vivem na mesma máquina; distribuir de verdade exige decisão adicional.
- **Adapters perdem a liberdade de gerenciar processos do seu jeito.** Serviço tem que subir destacado, com saída num arquivo de caminho ditado pelo núcleo. Um adapter que queira supervisionar de perto (restart automático, health check) não tem onde encaixar isso sem virar daemon.
- **Arquivos de log passam a acumular no disco** e ninguém os apaga hoje. `ns rm` precisa limpar o diretório de estado da branch, e rotação vira assunto.
- **O `ns` ganha uma dependência externa nova, o tmux**, que não vem no macOS. `ns doctor` passa a checá-la e `ns init` a mencionar. É a primeira dependência do CLI que não é git, docker ou o runtime.
- **O hábito diário muda.** A janela do Terminal.app deixa de conter o serviço e passa a estar atachada a ele. Ctrl-C na janela continua chegando ao processo (é um TTY de verdade), mas fechar a janela deixa de derrubar — o que é o objetivo, e ao mesmo tempo é uma pegadinha para quem fechava a janela justamente para parar o serviço. Parar passa a ser sempre `ns stop`.
- **`ns stop` fica com duas responsabilidades**: derrubar as sessões tmux e continuar matando por porta, para não deixar órfão nem quebrar serviço que tenha subido por fora.

## Alternativas consideradas

- **Uma abstração única de "plugin"** que registrasse comandos, escutasse eventos e pudesse subir servidor. Descartada porque a interface browser precisa de privilégios e de um ciclo de vida que um hook não tem — o mecanismo resultante serviria mal aos dois casos.
- **Browser fazendo shell-out de `ns --json`**, sem mudança arquitetural. Funcionaria para leitura, mas não há como responder a um `confirm` no meio de `ns start`, nem como receber progresso de uma operação de minutos, nem como recuperar dado que hoje só existe como texto colorido.
- **`ns serve` embutido no núcleo.** Mais simples e mais seguro, mas transformaria a interface browser em feature nativa e limitaria todo plugin futuro ao que aquele servidor decidisse expor — o oposto da intenção.
- **Protocolo JSON por subprocesso** como fronteira única. Dá isolamento e independência de linguagem, mas o plugin browser ainda precisaria do próprio servidor por cima, então é trabalho a mais antes de resolver o caso de uso. Continua possível depois, **como adapter**.
- **Diretório `~/.config/ns/plugins/` com carregamento dinâmico pelo binário.** Unificaria adapters e hooks sob um mecanismo só, mas exigiria o binário compilado resolver dependências de TypeScript arbitrário no disco — e o caso de uso motivador não precisa disso, porque num adapter o plugin é o programa principal.
- **Expor todo o código como superfície pública.** Liberdade máxima e zero cerimônia, defensável enquanto houver um único autor de plugins. Descartada porque congelaria assinaturas que hoje existem só para teste, e toda refatoração interna viraria quebra.
- **Eventos tipados por operação.** Tipagem forte e UI rica por passo, ao custo de código dedicado por operação no plugin — e operação nova nasceria invisível na interface até alguém escrever o renderizador dela.
- **Daemon supervisor (`ns daemon`)** dono dos serviços, servindo logs, status e restart a qualquer adapter. Resolveria o mesmo problema com mais poder — health check, restart automático, histórico. Descartada porque introduz um processo de longa duração para subir, monitorar e matar, e contradiz o núcleo observacional e sem estado que já funciona: hoje ninguém é dono de nada e a porta basta como identidade.
- **Adapter dono dos processos, sem log persistente.** O plugin captura stdout por pipe e mostra enquanto estiver aberto. Mais simples, mas fechar o browser deixaria o serviço vivo e mudo — e um processo escrevendo em cano órfão pode até cair.
- **`nohup` com saída em arquivo, sem multiplexer.** Zero dependência e nenhuma peça móvel; o serviço fica imortal de verdade. Descartada porque mata o console interativo do `quarkus:dev` e do vite — sem TTY não há `r`, `s`, nem runner de testes — e transformaria "reiniciar o backend" em parar e subir de novo.
- **Adapter terminal como exceção**, hospedando serviços porque "sempre foi assim". Descartada por contradizer o princípio no ponto exato em que ele importa: sair do terminal para usar o browser passaria a exigir reiniciar tudo, que é justamente o que se quer evitar.
- **Operação como async generator bidirecional**, yieldando eventos e recebendo respostas via `next()`. Streaming sai de graça, mas não sobrevive bem à fronteira de processo onde o adapter browser vive.
