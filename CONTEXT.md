# Context — ns CLI

Glossário da linguagem do domínio. Apenas termos e seus significados — sem detalhes de implementação.

## Termos

### Branch (de workspace)
Um ambiente de trabalho isolado para uma branch git: árvore de trabalho própria e um banco PostgreSQL próprio. Cada branch tem o seu banco, independente das demais.

### Apelido (nickname)
Um nome humano dado a uma branch de workspace para encontrá-la com facilidade (ex.: `agenda-recorrente` para `NS-1433`). É só um rótulo para ver: não muda o nome da branch, a pasta, o banco, as portas nem as URLs, e não substitui o nome da branch nos comandos. Não precisa ser único, e some junto com a branch.
_Evitar:_ "slug" (é o identificador derivado do nome da branch, usado no banco, no tmux e nas URLs), "alias" (são os endereços do Portless), "label".

### Snapshot
Uma cópia salva do estado do banco de uma branch, tirada num momento específico. Um snapshot **pertence** à branch que o criou (sua **branch de origem**), e seu nome é único dentro dela. Remover a branch pode levar os snapshots junto ou deixá-los como **snapshots órfãos**.

### Snapshot órfão
Um snapshot cuja branch de origem já não existe como worktree. Continua sendo um snapshot da sua branch de origem e pode ser restaurado em outra branch.

### Referência de snapshot (`branch:nome`)
A forma canônica de endereçar um snapshot, inclusive a partir de outra branch. Escrita como `<branch-de-origem>:<nome>` (ex.: `master:snapshot1`).
- O `:` é usado como separador porque o git **proíbe** `:` em nomes de branch, o que elimina ambiguidade (ao contrário de `/`, comum em nomes de branch).
- Um nome **sem** `:` refere-se a um snapshot da própria branch (forma curta).

### Restaurar (restore)
Sobrescrever o banco de uma **branch alvo** com o conteúdo de um snapshot. A branch alvo (onde o banco é substituído) e a branch de origem (de quem é o snapshot) podem ser diferentes.

### Serviço
Um processo que precisa estar no ar para uma branch funcionar (backend, frontend, manager, report-server). A identidade de um serviço é a **porta** que ele ocupa — não o processo que o iniciou, nem quem o iniciou.

Nenhum adapter é dono de um serviço: qualquer um pode encontrá-lo, acompanhá-lo, interagir com ele e pará-lo, inclusive um adapter que nem existia quando o serviço subiu. **Sair de um adapter nunca encerra um serviço** — vale igualmente para fechar a aba do browser e para fechar a janela do terminal. Parar um serviço é sempre um ato explícito.

### Estado de serviço
Em que situação um serviço está: **Rodando** quando atende na sua porta, venha de onde vier; **Iniciando** quando a sessão tmux dele está viva mas a porta ainda não responde; **Falhou** quando o processo terminou sem ser parado (a sessão fica aberta com a saída do erro); **Parado** quando não há porta nem sessão. O banco só tem Rodando e Parado.

### Plano de serviços
A lista de serviços que uma branch precisa ter no ar (backend, frontend, manager, report-server), cada um descrito por rótulo, diretório, variáveis de ambiente e comando, mais o nome da sessão tmux e o arquivo de log onde o serviço roda e grava a saída. É um **dado**: não executa nada, mas fixa esses dois endereços para que qualquer adapter encontre o mesmo serviço.

### Preparar (prepare)
Deixar uma branch pronta para os serviços subirem: portas alocadas, banco no ar, aliases registrados, dependências instaladas. Produz o plano de serviços. Não põe nenhum serviço no ar.

### Iniciar (start)
Preparar a branch **e** colocar o plano de serviços em execução, cada serviço na sua sessão tmux. Quem inicia escolhe só como mostrar o serviço (janela do terminal, aba, painel); sem tmux, o terminal cai no modo antigo, com o serviço dentro da janela.

### Repo (de workspace)
Cada repositório git que compõe uma branch de workspace (backend, frontend e, quando presentes, manager, report-server, docs e parents). Cada repo tem seu próprio histórico e sua própria branch principal.

### Branch principal (`@default`)
A branch de integração de um repo — a que o remoto aponta como padrão. Varia por repo (`master` em uns, `main` em outros), por isso é referida pelo apelido `@default`, que é resolvido individualmente em cada repo. Por enquanto, o apelido só é aceito pelo `pull`.

## Termos — modelo de extensão

### Núcleo
O conjunto de operações sobre o workspace (criar branch, iniciar serviços, tirar snapshot, restaurar…), definido independentemente de como o usuário as aciona ou de como o resultado é apresentado. O núcleo não pertence ao terminal.

### Adapter
Quem **dirige** o núcleo e apresenta o resultado a um usuário ou sistema. Extensão de fora para dentro. O terminal é um adapter, não *o* CLI; uma interface browser é outro adapter da mesma capacidade.

### Hook
Ponto nomeado onde o **núcleo chama** código externo durante uma operação. Extensão de dentro para fora. Um hook reage a um evento do núcleo; não decide o que a operação faz.

### Plugin
Unidade instalável de extensão. Um plugin empacota um adapter, hooks, ou ambos. "Plugin" descreve **distribuição**, não papel: a pergunta "isso é um adapter ou um hook?" continua valendo dentro de um plugin.
