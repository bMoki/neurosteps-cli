# Context — ns CLI

Glossário da linguagem do domínio. Apenas termos e seus significados — sem detalhes de implementação.

## Termos

### Branch (de workspace)
Um ambiente de trabalho isolado para uma branch git: árvore de trabalho própria e um banco PostgreSQL próprio. Cada branch tem o seu banco, independente das demais.

### Snapshot
Uma cópia salva do estado do banco de uma branch, tirada num momento específico. Um snapshot **pertence** à branch que o criou (sua **branch de origem**) e é **removido junto com ela** — não há snapshot órfão de branch inexistente.

### Referência de snapshot (`branch:nome`)
A forma canônica de endereçar um snapshot, inclusive a partir de outra branch. Escrita como `<branch-de-origem>:<nome>` (ex.: `master:snapshot1`).
- O `:` é usado como separador porque o git **proíbe** `:` em nomes de branch, o que elimina ambiguidade (ao contrário de `/`, comum em nomes de branch).
- Um nome **sem** `:` refere-se a um snapshot da própria branch (forma curta).

### Restaurar (restore)
Sobrescrever o banco de uma **branch alvo** com o conteúdo de um snapshot. A branch alvo (onde o banco é substituído) e a branch de origem (de quem é o snapshot) podem ser diferentes.

### Serviço
Um processo que precisa estar no ar para uma branch funcionar (backend, frontend, manager, report-server). A identidade de um serviço é a **porta** que ele ocupa — não o processo que o iniciou, nem quem o iniciou.

Nenhum adapter é dono de um serviço: qualquer um pode encontrá-lo, acompanhá-lo, interagir com ele e pará-lo, inclusive um adapter que nem existia quando o serviço subiu. **Sair de um adapter nunca encerra um serviço** — vale igualmente para fechar a aba do browser e para fechar a janela do terminal. Parar um serviço é sempre um ato explícito.

### Plano de serviços
A lista de serviços que uma branch precisa ter no ar (backend, frontend, manager, report-server), cada um descrito por rótulo, diretório, variáveis de ambiente e comando. É um **dado**: descreve o que rodar, sem dizer onde os processos vão morar.

### Preparar (prepare)
Deixar uma branch pronta para os serviços subirem: portas alocadas, banco no ar, aliases registrados, dependências instaladas. Produz o plano de serviços. Não põe nenhum serviço no ar.

### Iniciar (start)
Preparar a branch **e** colocar o plano de serviços em execução. Onde os processos passam a viver é escolha de quem inicia, não da operação.

## Termos — modelo de extensão

### Núcleo
O conjunto de operações sobre o workspace (criar branch, iniciar serviços, tirar snapshot, restaurar…), definido independentemente de como o usuário as aciona ou de como o resultado é apresentado. O núcleo não pertence ao terminal.

### Adapter
Quem **dirige** o núcleo e apresenta o resultado a um usuário ou sistema. Extensão de fora para dentro. O terminal é um adapter, não *o* CLI; uma interface browser é outro adapter da mesma capacidade.

### Hook
Ponto nomeado onde o **núcleo chama** código externo durante uma operação. Extensão de dentro para fora. Um hook reage a um evento do núcleo; não decide o que a operação faz.

### Plugin
Unidade instalável de extensão. Um plugin empacota um adapter, hooks, ou ambos. "Plugin" descreve **distribuição**, não papel: a pergunta "isso é um adapter ou um hook?" continua valendo dentro de um plugin.
