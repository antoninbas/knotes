# Knotes

Local-first note and activity log manager with hybrid search.

## Tech Stack

- **Runtime**: Node.js (compiled with esbuild; tsx used only in dev/test)
- **Backend**: Hono (web server), Commander (CLI), MCP SDK (MCP server)
- **Frontend**: SolidJS + Tailwind CSS v4 (built with Vite, needed for solid-js JSX transform)
- **Database**: better-sqlite3
- **Search**: @tobilu/qmd (BM25 + vector + hybrid)
- **Document import**: markitdown (Python CLI, called via child_process.spawn)

## Architecture

The server (`knotes server`) is the central hub. CLI commands and MCP tools route through the server's HTTP API by default. A serverless mode is available for simpler setups where no server is running.

- `src/core/` — Shared business logic (config, notes, logs, search, importer)
- `src/core/router.ts` — Routes operations to server (HTTP client) or direct (core) based on mode
- `src/core/client.ts` — HTTP client that mirrors core API, talks to the server
- `src/core/db.ts` — SQLite state DB (config, server heartbeat, jobs)
- `src/cli/` — Commander-based CLI (commands in `commands/`)
- `src/mcp/` — MCP server (stdio transport)
- `src/web/` — Hono API (`api/`) + SolidJS frontend (`app/`)
- `src/main.ts` — Single entrypoint

## Commands

Dev mode (running from source with tsx):
```sh
npx tsx src/main.ts --help              # CLI help
npx tsx src/main.ts server              # Start server (web UI + API)
npx tsx src/main.ts server --port 8080  # Custom port
npx tsx src/main.ts mcp                 # Start MCP server (stdio)
npx tsx src/main.ts mcp --read-only     # MCP server without write tools
npx tsx src/main.ts config show         # Show current config
npx tsx src/main.ts config edit         # Edit config in $EDITOR
npx tsx src/main.ts config set serverless true  # Enable serverless mode
npx tsx src/main.ts index              # Update search index
npx tsx src/main.ts embed              # Generate embeddings
```

Production build:
```sh
npm run build                           # Compile src/ → dist/ (requires frontend built first)
node dist/main.js --help               # Run compiled binary directly
```

## Frontend Development

```sh
cd src/web/app && npm install && npx vite dev    # Vite dev server (proxies /api to :7713)
cd src/web/app && npx vite build                 # Production build
```

## Testing

```sh
npx vitest run                            # Run all tests
KNOTES_HOME=/tmp/test npx vitest run      # Tests use temp KNOTES_HOME
```

## Conventions

- Use `node:fs` and `node:fs/promises` for file I/O (`readFileSync`, `writeFile`, etc.)
- Use `node:child_process` for subprocesses (`spawn`, `spawnSync`)
- All three interfaces (CLI, MCP, web) call into `src/core/router.ts` — not directly into notes/logs/search
- The server API (`src/web/api/`) calls core modules directly (it IS the server)
- Notes addressed by logical path without .md extension (e.g. `notes/projects/foo`)
- KNOTES_HOME env var sets storage root (default ~/.knotes)
- Config stored in SQLite (`.data/knotes.sqlite`), not settings.json
- Web server binds to 127.0.0.1 only — remote access via SSH forwarding or Tailscale
