# 99 — Pendências

O que ficou de fora da fatia, com o motivo. Nada aqui bloqueia [05](05-plugin-browser.md).

## Decisões em aberto

**Exit code por categoria de erro.**
`NsError` tem categoria desde [01](01-contratos-do-nucleo.md), mas todas mapeiam para exit 1, preservando o comportamento atual. Diferenciar (ex.: 4 = não encontrado, 5 = conflito) é bom para scripting e alinhado ao clig.dev, mas é mudança visível para quem já automatiza o `ns`. Decidir de propósito, não de passagem.

**Publicar o pacote do núcleo.**
`bun link` resolve enquanto plugin e CLI vivem na mesma máquina. Publicar em registry (ou instalar via git) só importa se outra pessoa for escrever plugin.

**tmux como dependência do `ns`.**
É a primeira dependência externa que não é git, docker ou runtime, e não vem no macOS. Definir: `ns doctor` checa e sugere `brew install tmux`; `ns init` menciona; `ns start` cai no comportamento antigo com aviso quando falta. Instalar automaticamente **não** — o `ns` nunca instalou nada na máquina do usuário e não é hora de começar.

**Limpeza dos arquivos de log.**
Com serviços escrevendo em `~/.local/state/ns/<branch>/<servico>.log`, os arquivos acumulam e ninguém os apaga. `ns rm <branch>` deveria remover o diretório de estado da branch, no mesmo raciocínio da ADR 0001 (soft preserva, `--purge` destrói). Rotação por tamanho é assunto separado e provavelmente desnecessário, já que o arquivo é truncado a cada start.

## Oportunidades que a fatia destrava

**`ns logs <branch> <servico>`.**
Com serviços escrevendo em arquivo, o adapter terminal ganha de graça algo que hoje não existe: ver o log do backend depois do fato, sem depender do scrollback da janela. (`ns db logs` é do banco, não dos serviços.) Não é escopo da fatia, mas é meia hora de trabalho depois da etapa [04](04-operacao-start.md).

## Fora de escopo por enquanto

**Hooks de terceiro.**
`src/lib/hooks.ts` tem `HookName` como união fechada, despachada por `if/else`; `settings.json` só liga/desliga o que já vem embutido. Carregar hook externo exigiria o binário compilado resolver dependências de um arquivo TypeScript arbitrário no disco — problema real, e não existe nenhum hook de terceiro querendo nascer. Adiado até haver um caso concreto. Adapters (incluindo o browser) **não** dependem disso.

**As outras 13 operações.**
`init`, `stop`, `rm`, `open`, `close`, `add`, `doctor`, `db` (8 subcomandos), `portless`, `workspace`, `config`. Migram sob demanda, quando alguma tela do browser precisar. A superfície pública cresce uma operação de cada vez (decisão 7).

**`add.ts` tem 16 `process.exit(1)`** — o maior ofensor do repositório, sozinho quase metade dos 33. Vale saber antes de migrar `add`.

**`ns completion` sai do núcleo.**
Gera script de autocomplete de shell: é assunto exclusivo do adapter terminal, um browser nunca vai querer. Não precisa migrar — precisa ficar onde está e nunca entrar em `src/core/`.

**Quebrar `new` em módulos.**
400 linhas fazendo git, portas, templates, VS Code, IntelliJ, DataGrip, hooks e seed. [03](03-operacao-new.md) só troca a casca (impressão, erros, eventos, resultado) de propósito, para a migração ser verificável. Refatorar a sequência interna é trabalho separado, depois.

## Incoerências encontradas durante o desenho

Ficam registradas mesmo quando o plano já as resolve, porque provavelmente existem em outros pontos:

**Duas políticas de interatividade.**
`lib/prompt.ts:19` lança erro quando não há TTY (usado por `rm`, `clear-db`, `snapshot`: sem terminal → aborta). `start.ts:78,104,131` pula em silêncio e degrada para um `hint`. As duas são defensáveis, mas o critério escolhido foi `process.stdout.isTTY` — que descreve o processo, não a capacidade de quem está do outro lado. Resolvido para `start` em [04](04-operacao-start.md) via `whenUnavailable`; os outros pontos continuam como estão.

**`prepare` instala dependências calado, `start` pergunta.**
Mesma situação de domínio, duas respostas. Resolvido em [04](04-operacao-start.md) como campo de input.

**`status` lê o estado duas vezes de formas diferentes.**
A visão compacta e a detalhada calculam coisas diferentes sobre a mesma branch. Unificado em [02](02-operacao-status.md).

**Só 2 classes de erro no projeto inteiro.**
`BranchNotFoundError` e `BranchShutdownNotFoundError`. Todo o resto é `throw new Error("texto")` ou `process.exit(1)` direto.
