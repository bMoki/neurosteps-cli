# ns-cli

CLI macOS-only para preparar workspaces locais com Git worktrees, Docker PostgreSQL, Portless e IDEs locais.

## Escopo

- Suporte oficial atual: macOS.
- A CLI usa dependencias macOS esperadas, como `open`, `osascript`, `/Applications` e `Terminal.app`.
- Nao ha abstracao multiplataforma neste ciclo.

## Fluxo principal

```bash
ns init
ns new <branch>
ns prepare <branch>
ns open <branch>
```

`ns init` apenas configura a CLI e bootstrapa diretorios/templates locais. Ele nao cria worktrees Git nem uma workspace `master`.

`ns new <branch>` cria worktrees de backend/frontend e inclui manager por padrao. Sem base explicita, a branch base e sempre `master`.

Para criar a partir de outra base:

```bash
ns new <branch> <base-branch>
```

## Logs

Logs do banco ficam apenas sob o namespace `db`:

```bash
ns db logs <branch>
```

O antigo comando top-level `ns logs <branch>` nao faz parte da superficie publica atual.

## IntelliJ

Branches criadas por `ns new` recebem run/debug configurations do IntelliJ em `.idea/runConfigurations`.

- `Backend <branch>` inicia o backend com `quarkus:dev` e porta de debug configurada.
- `Backend Debug <branch>` anexa o debugger remoto na porta gravada em `.workspace.env`.
- `Frontend <branch>` inicia o frontend com as variaveis da branch.

`ns open` abre a IDE configurada e prepara a branch quando aplicavel, mas nao sobrescreve run/debug configurations existentes.
