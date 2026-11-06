# 3. `ns rpc`: adapter stdio do núcleo em NDJSON

Data: 2026-11-04

## Status

Aceito.

Depende de: [ADR 0002](0002-nucleo-e-adapters.md). Motivada pela ADR-0002 do Thalamus (o Thalamus é um adapter do núcleo e fala com ele por `ns rpc`).

## Contexto

A ADR 0002 separa o `ns` em núcleo e adapters e deixa um protocolo JSON por stdio como adapter possível, "escrito depois, por fora". O Thalamus, a IDE do `ns`, é escrito em Swift e não importa o núcleo TypeScript. Ele precisa acionar operações de minutos (criar branch, preparar, iniciar), ver o progresso e responder às perguntas do meio da operação (`ctx.ask`).

Shell-out de `ns <comando> --json` não serve: não transmite progresso nem responde a `ask`, motivo pelo qual a ADR 0002 já o descartou para o browser. Um plugin Bun separado seria mais um binário para instalar e versionar, e só serviria ao Thalamus.

## Decisão

O próprio binário `ns` ganha o comando **`ns rpc`**: um processo de longa duração que fala **NDJSON** (uma mensagem JSON por linha) pelo stdin e pelo stdout. Ele é um adapter como o terminal: implementa o `NsContext` traduzindo `emit` e `ask` em mensagens, e não acrescenta lógica de domínio.

### 1. Mensagens

Do cliente para o `ns`:

```json
{"type":"op","id":"r1","op":"status","input":{"branch":"feat"}}
{"type":"answer","id":"r1","ask":"a1","value":true}
```

Do `ns` para o cliente:

```json
{"type":"ready","protocol":1,"ops":["status"]}
{"type":"event","id":"r1","event":{"step":"status:branch","label":"Lendo status de feat...","index":1,"total":1}}
{"type":"ask","id":"r1","ask":"a1","question":{"id":"start.install-deps.frontend","message":"...","default":true,"whenUnavailable":"default"}}
{"type":"result","id":"r1","result":{"branches":[]}}
{"type":"error","id":"r1","error":{"category":"conflito","message":"...","hint":"..."}}
```

- `ready` é a primeira linha. Anuncia a versão do protocolo e as operações servidas, para o cliente saber o que este `ns` sabe fazer.
- O `id` é escolhido pelo cliente e correlaciona tudo que pertence a uma requisição. Várias requisições correm ao mesmo tempo; um `id` só pode ser reutilizado depois que a requisição anterior com ele terminar.
- `event` segue a regra da ADR 0002: é para exibir. O dado que importa vem tipado no `result`.
- `ask` leva um id próprio, gerado pelo `ns`, e a pergunta do núcleo como está. A operação espera o `answer` correspondente.
- Cada requisição termina com exatamente um `result` ou um `error`.

### 2. Erros por categoria

`error.category` é uma das categorias do núcleo (`nao-encontrado`, `conflito`, `pre-condicao`, `ferramenta-externa`, `cancelado`) ou uma das duas do protocolo. O conjunto fechado do núcleo (decisão 7 da ADR 0002) não muda: as duas a mais existem só no protocolo e nunca são lançadas pelo núcleo.

- `protocolo`: linha que não é JSON, mensagem fora do formato, operação desconhecida, input que não passa na validação, `id` repetido em andamento, resposta a uma pergunta que não está pendente. Quando a linha não permite saber o `id`, ele vai `null`.
- `interno`: qualquer erro que não seja `NsError`. É um bug do `ns`; o stack vai para o stderr.

Nenhum erro derruba o processo; ele segue atendendo as próximas linhas. Um resultado que não pode ser enviado como JSON vira `interno` na mesma requisição.

Sem configuração (`ns init` não rodado), o `ns rpc` sobe e anuncia as operações do mesmo jeito, e cada uma responde `pre-condicao` com a dica de rodar `ns init`. O cliente sempre recebe uma resposta no protocolo, em vez de um processo que morre calado.

### 3. Cliente que some

Quando o stdin fecha, o `ns rpc` não aceita mais mensagens. Perguntas pendentes e perguntas feitas dali em diante aplicam o `whenUnavailable` da própria pergunta (`default` segue com o padrão, `abort` cancela a operação com `cancelado`), exatamente como faz o contexto silencioso. O processo termina quando as operações em andamento terminarem.

### 4. O stdout é só do protocolo

Nada além de mensagens do protocolo sai no stdout. Logs e diagnósticos vão para o stderr. Enquanto o `ns rpc` serve, `console.log` e a saída dos processos filhos não silenciosos (git, docker, npm) vão para o stderr, para que nada interno corrompa o protocolo.

### 5. Operações servidas

Só operações já migradas para o núcleo. A primeira é `status`. Cada operação que migrar entra no registro do `ns rpc` com o schema do seu input; a superfície continua sendo a da decisão 6 da ADR 0002.

`start` é a exceção que confirma a regra: é `prepare` mais a execução do Plano de serviços em sessões tmux, pelo mesmo helper que o `ns start` usa. Executar o plano é papel de adapter (o núcleo só o devolve), e o `ns rpc` é um adapter. Sem tmux, `start` responde `pre-condicao` antes de preparar, porque um Serviço que morre junto com o cliente contraria a regra de que ninguém é dono de um Serviço.

## Consequências

**Positivas**

- Qualquer cliente que não seja TypeScript (o Thalamus hoje) aciona o núcleo com progresso e perguntas, sem instalar nada além do `ns`.
- O protocolo vive junto com o núcleo e é versionado com ele: operação migrada aparece no `ready` sem trabalho no cliente.
- O comportamento sem cliente é o mesmo do contexto silencioso, então não há uma terceira política de interatividade.

**Negativas / trade-offs**

- O `ns` passa a ter um contrato de protocolo para manter. Mudança incompatível exige subir `protocol`.
- Não há cancelamento de uma requisição em andamento. Fica para quando uma operação longa precisar.
- O processo não tem autenticação: quem consegue iniciá-lo já tem a máquina. Diferente de um servidor HTTP em `localhost`, o stdio não é alcançável por uma página web.

## Alternativas consideradas

- **Plugin Bun separado que importa o núcleo.** Segue a ADR 0002 ao pé da letra, mas é mais um binário para instalar e versionar, e só serviria ao Thalamus.
- **JSON-RPC 2.0.** Padrão conhecido, mas não tem progresso nem pergunta do servidor ao cliente; os dois virariam notificações com convenção própria, e o ganho do padrão se perde.
- **Servidor HTTP/websocket local (`ns serve`).** Serviria ao browser também, mas abre a porta para qualquer página no `localhost` (ver ADR 0002) e exige token e verificação de `Origin`. Para um cliente que já inicia o processo, stdio é mais simples e mais seguro.
- **Um processo `ns` por operação, com NDJSON só naquela execução.** Evita o processo de longa duração, mas paga a inicialização a cada `status`, que o Thalamus consulta com frequência.
