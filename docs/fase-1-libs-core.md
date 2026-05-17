# Fase 1: Libs Core

## Objetivo
Reescrever `common.sh` e helpers como módulos TypeScript testáveis.

## Módulos a criar

### `lib/config.ts`
Paths, constants, `readWorkspaceEnv()`, `resolve*Dir()`, `slugify()`

### `lib/ports.ts`
- `isPortAvailable(port)` — usa `lsof -ti :port`
- `getNextPort(base)` — encontra próxima porta livre
- `allocatePorts(branch)` — aloca DB_PORT, BACKEND_PORT, FRONTEND_PORT, MANAGER_PORT

### `lib/shell.ts`
- `exec(cmd, args)` — Promise-based spawn
- `execSync(cmd, args)` — Synchronous spawn
- `spawnTerminal(cwd, env, command)` — AppleScript para abrir Terminal.app

### `lib/docker.ts`
- `dockerComposeUp(composeFile, project)`
- `dockerComposeDown(composeFile, project)`
- `dockerVolumeCreate(name)`
- `dockerVolumeRm(name)`
- `dockerVolumeCopy(from, to)` — `docker run --rm alpine cp -a`
- `dockerVolumeExists(name)`
- `dockerPs(containerName)` — verifica se container está rodando
- `dockerExec(container, cmd)` — executa comando no container

### `lib/git.ts`
- `branchExistsOnOrigin(repo, branch)` — `git ls-remote`
- `createLocalBranch(repo, branch, base)`
- `createWorktree(repo, path, branch)` — `git worktree add`
- `removeWorktree(repo, path)` — `git worktree remove`
- `fetchOrigin(repo)` — `git fetch origin`

### `lib/portless.ts`
- `registerAlias(name, port)`
- `removeAlias(name)`
- `listAliases()` — parse output de `portless list`
- `isProxyRunning()` — `lsof -ti :1355`
- `startProxy()` — `portless proxy start -p 1355`

### `lib/templates.ts`
- `renderTemplate(templatePath, variables)` — lê arquivo e faz replace de placeholders
- `copyTemplate(src, dst, variables)` — copia com renderização
- `generateWorkspaceEnv(branch, vars)` — gera `.workspace.env`

## Testes
Cada módulo deve ter testes unitários com mocks de `Bun.$`, `Bun.file`, etc.

## Critério de aceitação
- [ ] Todos os módulos criados
- [ ] Todos os testes passando
- [ ] Coverage ≥ 80% nos módulos `lib/`
