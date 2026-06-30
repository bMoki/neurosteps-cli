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
