# ns-cli

CLI local do NeuroSteps para organizar workspaces por branch usando Git worktrees, Docker PostgreSQL, Portless e IDEs no macOS.

O binário público é `ns`.

Este README segue o framework Diátaxis:

| Seção | Objetivo |
| --- | --- |
| [Tutorial](#tutorial-começar-do-zero) | Fazer o primeiro setup funcionando. |
| [Guias](#guias-tarefas-comuns) | Resolver tarefas comuns do dia a dia. |
| [Referência](#referência) | Consultar comandos, variáveis e opções. |
| [Explicação](#explicação-como-a-cli-funciona) | Entender o modelo mental da CLI. |

## Tutorial: começar do zero

### 1. Tenha os repositórios base clonados

A CLI não clona os repositórios principais. Ela espera que backend, frontend e, se usado, manager já existam localmente. A partir desses repositórios base, o `ns new` cria worktrees em outra pasta.

Layout recomendado antes de usar a CLI:

```text
~/Developer/
  scalemed-backend/
  frontend/
  neurosteps-manager/
```

Com os valores padrão atuais, esses caminhos significam:

| Repositório | Caminho padrão |
| --- | --- |
| Backend | `~/Developer/scalemed-backend` |
| Frontend | `~/Developer/frontend` |
| Manager | `~/Developer/neurosteps-manager` |

O `ns new <branch>` usa `origin/master` como branch base por padrão. Essa branch precisa existir no origin de cada repositório usado; a branch local `master` não é necessária.

Para criar uma workspace a partir de outra base, informe a base explicitamente:

```bash
ns new minha-branch release/2026-05
```

### 2. Instale a CLI

```bash
bun install
bun run build
bun run install-global
```

O script `install-global` compila `dist/ns`, copia para `~/.local/bin/ns` e instala autocomplete. Garanta que `~/.local/bin` esteja no seu `PATH`.

### 3. Configure os caminhos

Rode o assistente interativo:

```bash
ns init
```

Durante o `ns init`, a CLI pergunta o diretório base, tenta detectar repositórios Git nessa pasta e grava a configuração em:

```text
~/.config/ns/env.json
```

Você pode ver a configuração atual com:

```bash
ns config env
```

Se os repositórios não estiverem nos caminhos padrão, configure caminhos absolutos no assistente ou via variáveis `NS_BACKEND_REPO`, `NS_FRONTEND_REPO` e `NS_MANAGER_REPO`.

### 4. Crie a primeira workspace

```bash
ns new minha-branch
```

Isso cria uma workspace em:

```text
~/Developer/worktrees/minha-branch/
```

Ela terá `backend`, `frontend`, `manager`, `.workspace.env`, `docker-compose.yml` e arquivos de IDE.

Prepare DB e aliases Portless:

```bash
ns prepare minha-branch
```

Abra no IDE configurado:

```bash
ns open minha-branch
```

### 5. Trabalhe e encerre

Inicie os serviços em terminais:

```bash
ns start minha-branch
```

Pare serviços e aliases:

```bash
ns stop minha-branch
```

Pare serviços e feche a janela do IDE:

```bash
ns close minha-branch
```

## Guias: tarefas comuns

### Criar uma branch sem manager

```bash
ns new minha-branch --no-manager
```

### Adicionar manager depois

```bash
ns add manager minha-branch
```

### Preparar uma branch já criada

```bash
ns prepare minha-branch
```

`prepare` sobe o PostgreSQL, inicia o proxy Portless se necessário e registra aliases de backend, frontend e manager.

### Abrir sem preparar serviços

```bash
ns open minha-branch --no-prepare
```

### Abrir em um app específico

```bash
ns open minha-branch --app intellij
ns open minha-branch --app vscode
```

### Ver status

```bash
ns status
ns status minha-branch
ns status --all
```

### Diagnosticar e corrigir

```bash
ns doctor minha-branch
ns doctor minha-branch --fix
```

### Trabalhar com o banco

```bash
ns db start minha-branch
ns db port minha-branch
ns db logs minha-branch
ns db open minha-branch
```

### Criar e restaurar snapshot

```bash
ns db snapshot minha-branch antes-migracao
ns db restore minha-branch antes-migracao
```

### Remover uma workspace

```bash
ns rm minha-branch
```

Para remover também o volume Docker do banco:

```bash
ns rm minha-branch --purge
```

Para remover sem confirmação e descartar alterações locais nas worktrees:

```bash
ns rm minha-branch --force
```

## Referência

### Requisitos

| Requisito | Por quê |
| --- | --- |
| macOS | A CLI usa `open`, `osascript`, `/Applications` e `Terminal.app`. |
| Bun 1.3+ | Runtime, testes e build do binário. |
| Git | Branches e worktrees. |
| Docker | PostgreSQL por branch, volumes, seed e snapshots. |
| Portless CLI | Proxy local e aliases por branch. |
| Repos locais | Backend, frontend e manager são origem das worktrees. |

### Opções globais

| Opção | Uso |
| --- | --- |
| `--debug` | Mostra stack trace em erros inesperados. |
| `--no-color` | Desativa cores na saída. |
| `--no-input` | Desativa prompts interativos; comandos que precisam perguntar falham com instrução. |

### Comandos de setup e configuração

| Comando | O que faz | Observação |
| --- | --- | --- |
| `ns init` | Configura a CLI e cria diretórios/templates base. | Não cria worktree nem workspace `master`. |
| `ns init --reconfig` | Refaz o assistente de configuração. | Útil para trocar caminhos, portas ou credenciais. |
| `ns config env` | Mostra o `env.json` carregado. | Caminho padrão: `~/.config/ns/env.json`. |
| `ns config env --path` | Imprime o caminho do `env.json`. | Útil para inspeção manual. |
| `ns config env --edit` | Abre a reconfiguração interativa. | Equivale a reconfigurar pelo init. |
| `ns config list` | Lista preferências salvas. | Lê `~/.config/ns/settings.json`. |
| `ns config get <key>` | Lê uma preferência. | Exemplo: `defaultIde`. |
| `ns config set <key> <value>` | Define uma preferência. | Exemplo: `ns config set databaseApp datagrip`. |
| `ns config detect-apps` | Lista apps detectados em `/Applications`. | Ajuda a configurar IDE e app de banco. |
| `ns completion install` | Instala autocomplete para o shell detectado. | Suporta fish, bash e zsh. |
| `ns completion fish` | Gera completion para fish. | Também existe para `bash` e `zsh`. |

### Comandos de branch e workspace

| Comando | O que faz | Observação |
| --- | --- | --- |
| `ns new <branch>` | Cria worktrees configuradas para backend, frontend e manager. | Usa `master` como base. |
| `ns new <branch> <base>` | Cria worktrees a partir de `origin/<base>`. | A base precisa existir no origin dos repositórios usados. |
| `ns new <branch> --no-manager` | Cria workspace sem manager. | Manager pode ser adicionado depois. |
| `ns add manager <branch>` | Adiciona manager a uma workspace existente. | Usa `master` como base por padrão. |
| `ns add manager <branch> --base <base>` | Adiciona manager a partir de `origin/<base>`. | A base precisa existir no origin do repositório manager. |
| `ns add manager <branch> --port <port>` | Adiciona manager com porta específica. | Atualiza `.workspace.env`. |
| `ns add report-server <branch>` | Adiciona report-server a uma workspace existente. | Repo opcional, sob demanda. Usa `master` como base por padrão. |
| `ns add report-server <branch> --base <base>` | Adiciona report-server a partir de `origin/<base>`. | A base precisa existir no origin do repositório report-server. |
| `ns add report-server <branch> --port <port>` | Adiciona report-server com porta específica. | Atualiza `.workspace.env`. |
| `ns rm <branch>` | Remove worktrees e branches locais. | Pede confirmação. |
| `ns rm <branch> --purge` | Remove também o volume Docker e todos os snapshots da branch. | Destrutivo e irreversível. |
| `ns rm <branch> --force` | Remove sem confirmação e força remoção de worktrees sujas. | Descarta alterações locais não commitadas nas worktrees. |

### Comandos de runtime

| Comando | O que faz | Observação |
| --- | --- | --- |
| `ns prepare <branch>` | Sobe PostgreSQL e registra aliases Portless. | Fluxo recomendado antes de abrir/trabalhar. |
| `ns open <branch>` | Prepara e abre a workspace no IDE configurado. | Não sobrescreve configs IntelliJ existentes. |
| `ns open <branch> --no-prepare` | Abre a workspace sem subir DB/aliases. | Útil quando já está tudo rodando. |
| `ns open <branch> --app <name>` | Abre em um app específico. | Exemplo: `intellij`, `vscode`, `webstorm`. |
| `ns start <branch>` | Sobe DB, aliases e terminais dos serviços. | Backend, frontend e manager quando existir. |
| `ns stop <branch>` | Para DB, remove aliases e mata processos das portas. | Compartilha rotina de shutdown com `close`. |
| `ns close <branch>` | Faz `stop` e fecha janelas do IDE. | Fecha janelas cujo nome contém a branch. |
| `ns portless <branch>` | Registra aliases Portless da branch. | Não sobe todos os serviços. |

### Comandos de status e diagnóstico

| Comando | O que faz | Observação |
| --- | --- | --- |
| `ns status` | Mostra status compacto de todas as branches. | Lê `~/Developer/worktrees` ou `NS_BASE_DIR/worktrees`. |
| `ns status <branch>` | Mostra detalhes de uma branch. | Inclui portas, DB e aliases. |
| `ns status --all` | Mostra detalhes de todas as branches. | Mais verboso. |
| `ns doctor <branch>` | Diagnostica configuração da branch. | Verifica worktree, env, Docker, Portless e portas. |
| `ns doctor <branch> --fix` | Tenta corrigir problemas conhecidos. | Pode recriar templates, volume e aliases. |

### Comandos de banco

| Comando | O que faz | Observação |
| --- | --- | --- |
| `ns db start <branch>` | Sobe apenas o PostgreSQL. | Usa `docker-compose.yml` da branch. |
| `ns db reset <branch>` | Apaga e reseeda o volume da branch. | Destrutivo, pede confirmação. |
| `ns db port <branch>` | Imprime a porta do banco. | Útil para conectar manualmente. |
| `ns db logs <branch>` | Segue logs do container PostgreSQL. | Use Ctrl+C para sair. |
| `ns db open <branch>` | Abre a workspace no app de banco configurado. | Exemplo: DataGrip, TablePlus, DBeaver. |
| `ns db open <branch> --app <name>` | Abre em um app de banco específico. | Exemplo: `datagrip`. |

### Comandos de snapshot

| Comando | O que faz | Observação |
| --- | --- | --- |
| `ns db snapshot <branch>` | Cria snapshot com nome automático. | Para e reinicia o PostgreSQL durante a cópia. |
| `ns db snapshot <branch> <name>` | Cria snapshot nomeado. | Salva metadados em `snapshots/<branch>`. |
| `ns db snapshots` | Lista snapshots de todas as branches. | Mostra nome, data e volume. |
| `ns db snapshots <branch>` | Lista snapshots de uma branch. | Filtra por branch. |
| `ns db restore <branch> <name>` | Restaura snapshot no banco da branch. | Destrutivo, pede confirmação. |
| `ns db restore <branch> latest` | Restaura o snapshot mais recente da própria branch. | Usa o ponteiro `latest` da branch alvo. |
| `ns db restore <alvo> <origem>:<nome>` | Restaura snapshot de outra branch. | Cross-branch: lookup em `<origem>`, restore em `<alvo>`. |
| `ns db restore <alvo> <origem>:latest` | Restaura o snapshot mais recente de outra branch. | Resolve `latest` na branch de origem. |
| `ns db restore <branch> <name> --force` | Restaura sem confirmação. | Use com cuidado. |
| `ns db rm-snapshot <branch> <name>` | Remove um snapshot. | Remove volume e metadados. |
| `ns db rm-snapshot <branch> <name> --force` | Remove sem confirmação. | Use com cuidado. |

### Comandos de templates e desenvolvimento

| Comando | O que faz | Observação |
| --- | --- | --- |
| `ns workspace template save <branch>` | Captura configuração atual do IDE como template. | Usa a workspace da branch como fonte. |
| `ns workspace template apply <branch>` | Aplica templates de IDE na branch. | Reaplica arquivos conhecidos. |
| `bun run dev -- --help` | Executa o CLI via Bun em modo dev. | Útil durante desenvolvimento. |
| `bun run test` | Roda a suíte de testes com preload de env. | Script oficial do repositório. |
| `bun run build` | Compila `dist/ns`. | Gera binário standalone. |
| `bun run install-global` | Compila, copia para `~/.local/bin/ns` e instala completion. | Instalação local recomendada. |

### Variáveis de ambiente

Obrigatórias:

| Variável | Exemplo | Uso |
| --- | --- | --- |
| `NS_PRODUCT_NAME` | `neurosteps` | Prefixo lógico de aliases, volumes e containers. |
| `NS_BACKEND_MODULE` | `scalemed` | Módulo Maven usado nos comandos do backend. |
| `NS_BACKEND_REPO_NAME` | `scalemed-backend` | Nome padrão da pasta do backend. |
| `NS_MANAGER_REPO_NAME` | `neurosteps-manager` | Nome padrão da pasta do manager. |
| `NS_SEED_VOLUME` | `scalemed-backend_neurosteps_bd_volume` | Volume Docker usado para seed de bancos novos. |

Opcionais:

| Variável | Default | Uso |
| --- | --- | --- |
| `NS_BASE_DIR` | `~/Developer` | Base dos repositórios, worktrees e workspace da CLI. |
| `NS_BACKEND_REPO` | `$NS_BASE_DIR/$NS_BACKEND_REPO_NAME` | Caminho absoluto do backend. |
| `NS_FRONTEND_REPO` | `$NS_BASE_DIR/frontend` | Caminho absoluto do frontend. |
| `NS_MANAGER_REPO` | `$NS_BASE_DIR/$NS_MANAGER_REPO_NAME` | Caminho absoluto do manager. |
| `NS_REPORT_SERVER_REPO_NAME` | `report-server` | Nome padrão da pasta do report-server (repo opcional). |
| `NS_REPORT_SERVER_REPO` | `$NS_BASE_DIR/$NS_REPORT_SERVER_REPO_NAME` | Caminho absoluto do report-server. |
| `NS_DB_USER` | `postgres` | Usuário PostgreSQL. |
| `NS_DB_PASSWORD` | `docker` | Senha PostgreSQL. |
| `NS_DB_NAME` | `app_database` | Nome do banco local. |
| `NS_MASTER_DB_PORT` | `5434` | Porta base para bancos. |
| `NS_MASTER_BACKEND_PORT` | `8080` | Porta base para backend. |
| `NS_MASTER_FRONTEND_PORT` | `3011` | Porta base para frontend. |
| `NS_MASTER_MANAGER_PORT` | `3020` | Porta base para manager. |
| `NS_MASTER_REPORT_SERVER_PORT` | `3030` | Porta base para report-server. |
| `NS_PORTLESS_PROXY_PORT` | `1355` | Porta do proxy Portless. |

### Comandos destrutivos

| Comando | Impacto |
| --- | --- |
| `ns rm <branch>` | Remove worktrees e branches locais. |
| `ns rm <branch> --purge` | Remove worktrees, branches locais, volume Docker e todos os snapshots da branch. |
| `ns rm <branch> --force` | Remove sem confirmação e descarta alterações locais nas worktrees. |
| `ns db reset <branch>` | Apaga o volume atual da branch e reseeda a partir de `NS_SEED_VOLUME`. |
| `ns db restore <branch> <snapshot>` | Substitui o banco atual pelo snapshot. |
| `ns db rm-snapshot <branch> <snapshot>` | Remove volume e metadados do snapshot. |

## Explicação: como a CLI funciona

### Como a CLI sabe onde estão os repositórios

A origem dos caminhos é `src/lib/env.ts`. Na prática, a CLI carrega `~/.config/ns/env.json` e depois aplica `process.env` por cima. Variáveis de ambiente do shell têm prioridade sobre o arquivo.

Resolução de caminhos:

| Caminho | Regra |
| --- | --- |
| Base | `NS_BASE_DIR`, padrão `~/Developer`. |
| Backend | `NS_BACKEND_REPO`, ou `NS_BASE_DIR/NS_BACKEND_REPO_NAME`. |
| Frontend | `NS_FRONTEND_REPO`, ou `NS_BASE_DIR/frontend`. |
| Manager | `NS_MANAGER_REPO`, ou `NS_BASE_DIR/NS_MANAGER_REPO_NAME`. |
| Report-server | `NS_REPORT_SERVER_REPO`, ou `NS_BASE_DIR/NS_REPORT_SERVER_REPO_NAME`. |
| Worktrees | `NS_BASE_DIR/worktrees`. |
| Templates e snapshots | `NS_BASE_DIR/<NS_PRODUCT_NAME>-workspace`. |

O `ns init` ajuda a montar esse arquivo. Ele pergunta o diretório base, detecta repositórios Git diretamente dentro dele e oferece usar os caminhos encontrados.

### O que o `ns new` faz

`ns new <branch>` valida que os repositórios base existem, valida que `origin/<base>` existe, busca origin, cria ou reaproveita branches locais e cria worktrees em `NS_BASE_DIR/worktrees/<branch>`.

Depois disso, ele aloca portas, gera `.workspace.env`, cria `docker-compose.yml`, aplica templates de backend/frontend/manager, cria arquivos de VS Code e IntelliJ e tenta copiar o volume `NS_SEED_VOLUME` para o volume da branch.

### Onde cada coisa fica

```text
~/Developer/
  scalemed-backend/           # repositório base backend
  frontend/                   # repositório base frontend
  neurosteps-manager/         # repositório base manager
  worktrees/
    minha-branch/             # workspace criada pela CLI
      backend/
      frontend/
      manager/
      .workspace.env
      docker-compose.yml
      minha-branch.code-workspace
  neurosteps-workspace/
    templates/
    snapshots/
    config/
```

### URLs Portless

Para `NS_PRODUCT_NAME=neurosteps` e branch `minha-branch`, os aliases ficam assim:

| Serviço | Alias | URL |
| --- | --- | --- |
| Backend | `minha-branch.api.neurosteps` | `https://minha-branch.api.neurosteps.localhost:1355/api` |
| Swagger | `minha-branch.api.neurosteps` | `https://minha-branch.api.neurosteps.localhost:1355/swagger-ui` |
| Frontend | `minha-branch.web.neurosteps` | `https://minha-branch.web.neurosteps.localhost:1355` |
| Manager | `minha-branch.manager.neurosteps` | `https://minha-branch.manager.neurosteps.localhost:1355` |

### IDEs e apps detectados

A CLI procura apps em `/Applications` e `/Applications/Setapp`.

Apps conhecidos:

| Tipo | Apps |
| --- | --- |
| IDE/editor | Visual Studio Code, IntelliJ IDEA, Cursor, Fleet, WebStorm. |
| Banco | DataGrip, TablePlus, DBeaver. |

Você pode configurar manualmente:

```bash
ns config set defaultIde intellij
ns config set databaseApp datagrip
```

### Limitações atuais

| Limitação | Detalhe |
| --- | --- |
| Plataforma | Suporte oficial apenas para macOS. |
| Clone de repositórios | A CLI não clona os repositórios base. Eles precisam existir localmente. |

## Desenvolvimento do CLI

Arquitetura principal:

```text
src/
  index.ts
  commands/
  actions/
  lib/
  __tests__/
```

Ao adicionar comando novo:

1. Crie a action em `src/actions/<nome>.ts`.
2. Crie o command em `src/commands/<nome>.ts`.
3. Exporte em `src/commands/index.ts`.
4. Registre em `src/index.ts`.
5. Adicione testes em `src/__tests__`.
6. Atualize completion em `src/commands/completion.ts`.

Regras importantes:

| Regra | Motivo |
| --- | --- |
| Todas as env vars passam por `src/lib/env.ts`. | Evita caminhos e nomes hardcoded. |
| Use `Bun.spawn()` ou `Bun.spawnSync()` para comandos externos. | Mantém execução padronizada. |
| Use `Bun.file()` e `Bun.write()` para I/O novo. | Mantém consistência no runtime Bun. |
| Valide worktree antes de operar. | Evita efeitos em caminhos errados. |
| Operações destrutivas devem pedir confirmação. | Protege banco e branches locais. |
| Setup de branch deve usar `setupBranchRuntime`. | Evita duplicar lógica de DB e Portless. |
| Shutdown de branch deve usar `shutdownBranchRuntime`. | Mantém `stop` e `close` consistentes. |
