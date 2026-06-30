# 1. Restauração de snapshot entre branches (cross-branch)

Data: 2026-06-12

## Status

Aceito (implementação pendente).

## Contexto

Cada branch de workspace tem o seu próprio banco PostgreSQL. O comando `ns db snapshot` salva o estado do banco de uma branch num volume Docker independente, com metadados em `snapshots/<branch>/<nome>.json`. Até aqui, `ns db restore <branch> <nome>` só conseguia restaurar um snapshot **da própria** branch alvo — o lookup do metadado era fixo em `snapshots/<branch-alvo>/`.

Surgiu a necessidade de **puxar o snapshot de outra branch** para o banco da branch atual (ex.: levar o estado de `master` para uma branch de feature antes de testar uma migration). Mecanicamente isso já era viável — `dockerVolumeCopy(snapshot.volume, alvo.DB_VOLUME)` é agnóstico de branch; o snapshot só estava "preso" à branch pelo caminho de lookup do metadado.

Duas decisões de design precisaram ser tomadas, ambas com alternativas reais:

1. **Como endereçar um snapshot de outra branch** na linha de comando.
2. **O que acontece com os snapshots quando a branch de origem é removida** — hoje o `ns rm` não os toca, deixando volumes e metadados órfãos.

## Decisão

### 1. Referência qualificada `branch:nome`

Um snapshot passa a ser endereçado por uma **referência qualificada** no formato `<branch-de-origem>:<nome>` (ex.: `master:snapshot1`).

- O separador é `:` porque o **git proíbe `:` em nomes de branch** (`git check-ref-format`), eliminando ambiguidade. A alternativa `/` foi descartada justamente porque `/` é comum em nomes de branch (`feature/foo`), tornando impossível saber onde termina a branch e começa o nome.
- Uma referência **sem** `:` continua significando "snapshot da própria branch alvo" — o comportamento atual de `ns db restore <branch> <nome>` é preservado, sem quebra.
- `restore` recebe a ref no 2º posicional: `ns db restore <alvo> <ref>`. A branch alvo (onde o banco é sobrescrito) e a branch de origem (de quem é o snapshot) são distintas.
- A ref é apenas **formato de endereço/exibição**. O armazenamento continua por pasta (`snapshots/<branch>/`); o `:` nunca é gravado em nome de arquivo. Isso evita o campo minado de `:` em nome de arquivo no macOS (tratado como separador de caminho legado pelo Finder) e dispensa qualquer migração de snapshots existentes.
- Criar snapshot com `:` no nome é **rejeitado**, para não quebrar o parser de ref.

### 2. Snapshots seguem o ciclo de vida da branch de origem

`ns rm` passa a tratar snapshots como **dado da branch**, em paralelo ao volume vivo do banco:

- `ns rm <branch>` (soft) — **mantém** o volume vivo e os snapshots (branch recuperável).
- `ns rm <branch> --purge` — **apaga** o volume vivo **e** todos os snapshots da branch (volumes Docker + a pasta `snapshots/<branch>`).

O gate para restaurar é apenas "o snapshot existe": a branch de origem não precisa ser um worktree vivo. Como o `rm` soft preserva os snapshots, ainda é possível restaurar a partir de uma origem soft-deletada.

## Consequências

**Positivas**
- Restaurar entre branches passa a ser uma operação de primeira classe, com uma sintaxe inequívoca.
- Zero migração: snapshots existentes continuam válidos.
- Sem órfãos: `--purge` não deixa mais volumes/metadados de snapshot soltos.
- Mensagens de confirmação e dry-run nomeiam origem e destino quando diferem, reduzindo o risco de sobrescrever o banco errado.

**Negativas / trade-offs**
- **Perda de "golden snapshots" no purge**: ao escolher "sem órfãos", abrimos mão de preservar um snapshot de uma branch descartada via `--purge`. Quem quiser manter um snapshot de uma branch que vai sumir precisa restaurá-lo/copiá-lo para uma branch sobrevivente antes, ou usar `rm` soft.
- `--purge` fica **mais destrutivo** do que era — agora remove também dados de snapshot. É uma operação difícil de reverter.
- A assimetria "`restore` aceita ref qualificada, `rm-snapshot` não" precisa ser comunicada: remoção é sempre escopada ao dono (`rm-snapshot <branch> <nome>`); a ref qualificada existe para **leitura** cross-branch.

## Alternativas consideradas

- **Flag `--from <branch>`** em vez de ref qualificada. Funcional, mas deixa o identificador do snapshot espalhado em dois lugares (nome + flag) e não dá um token único copiável a partir do `db snapshots`.
- **Nome qualificado com `/`** (`origem/nome`). Descartado pela ambiguidade com nomes de branch que contêm `/`.
- **Pool plano de snapshots** (sem associação a branch). Mudança maior, contraria o modelo mental de "snapshot pertence à branch que o criou" e exigiria migração.
- **`rm` sempre apaga snapshots** (mesmo soft). Descartado por inconsistência: guardaria o banco vivo recuperável mas jogaria fora os pontos salvos. Gatear no `--purge` mantém o paralelo "todo dado da branch é preservado no soft e destruído no purge".
