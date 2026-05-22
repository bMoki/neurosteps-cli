# Workspace CLI — Agent Guide

## Stack
- **Runtime**: Bun 1.3+
- **Language**: TypeScript 5.9+
- **CLI**: Commander.js
- **Validation**: Zod (env vars)
- **Tests**: bun:test (nativo)

## Architecture
```
src/
├── index.ts              # Entry point + commander setup
├── lib/
│   ├── env.ts            # Zod env schema (ALL env vars here)
│   ├── config.ts         # Paths, constants, env reader
│   ├── settings.ts       # CLI config (~/.config/ns/settings.json)
│   ├── apps.ts           # IDE/DB app detection
│   ├── ports.ts          # Port allocation (lsof)
│   ├── shell.ts          # Shell execution
│   ├── docker.ts         # Docker volume/compose helpers
│   ├── git.ts            # Git worktree helpers
│   ├── portless.ts       # Portless alias management
│   ├── templates.ts      # Template rendering/copying
│   └── logger.ts         # chalk + ora
├── commands/             # Commander command definitions
├── actions/              # Command business logic
└── __tests__/            # Test suites
```

## Env Vars
All configuration is via env vars validated by Zod in `src/lib/env.ts`:

| Variable | Required | Description |
|----------|----------|-------------|
| `NS_PRODUCT_NAME` | Yes | Product name (used for aliases, volumes, containers) |
| `NS_BACKEND_MODULE` | Yes | Backend module name |
| `NS_BACKEND_REPO_NAME` | Yes | Backend repo folder name |
| `NS_MANAGER_REPO_NAME` | Yes | Manager repo folder name |
| `NS_SEED_VOLUME` | Yes | Full Docker volume name for DB seeding |
| `NS_BASE_DIR` | No | Base directory (default: `~/Developer`) |
| `NS_BACKEND_REPO` | No | Override backend repo path |
| `NS_FRONTEND_REPO` | No | Override frontend repo path |
| `NS_MANAGER_REPO` | No | Override manager repo path |
| `NS_DB_USER` | No | PostgreSQL user (default: `postgres`) |
| `NS_DB_PASSWORD` | No | PostgreSQL password (default: `docker`) |
| `NS_DB_NAME` | No | PostgreSQL database (default: `app_database`) |
| `NS_PORTLESS_PROXY_PORT` | No | Portless proxy port (default: `1355`) |

## Golden Rules
1. **No hardcoded paths** — use `lib/env.ts`
2. **No hardcoded product names** — use `env.NS_PRODUCT_NAME`
3. **Each command implements its own logic** — no bash script wrappers
4. Use `Bun.spawn()` / `Bun.spawnSync()` for shell execution
5. Use `Bun.file()` and `Bun.write()` for file I/O
6. Always validate worktree existence before operating
7. Colors: info=blue, ok=green, warn=yellow, err=red
8. Spinners (ora) for commands > 2s
9. Interactive confirmations (@inquirer) for destructive actions

## Build
```bash
bun run build      # → dist/ns (single binary)
```

## Test
```bash
bun test
```

## Adding a New Command
1. Create action in `src/actions/<name>.ts`
2. Create command in `src/commands/<name>.ts`
3. Export from `src/commands/index.ts`
4. Register in `src/index.ts`
5. Add tests in `src/__tests__/actions/<name>.test.ts`
6. Update completion in `src/commands/completion.ts`

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, invoke the `skill` tool with `skill: "graphify"` before doing anything else.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
