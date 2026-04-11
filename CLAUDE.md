# Knotes

Local-first note and activity log manager with hybrid search. Built with Bun.

## Tech Stack

- **Runtime**: Bun
- **Backend**: Hono (web server), Commander (CLI), MCP SDK (MCP server)
- **Frontend**: SolidJS + Tailwind CSS v4 (built with Vite, needed for solid-js JSX transform)
- **Search**: @tobilu/qmd (BM25 + vector + hybrid)
- **Document import**: markitdown (Python CLI, called via Bun.spawn)

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

```sh
bun run src/main.ts --help              # CLI help
bun run src/main.ts server              # Start server (web UI + API)
bun run src/main.ts server --port 8080  # Custom port
bun run src/main.ts mcp                 # Start MCP server (stdio)
bun run src/main.ts mcp --read-only     # MCP server without write tools
bun run src/main.ts config show         # Show current config
bun run src/main.ts config edit         # Edit config in $EDITOR
bun run src/main.ts config set serverless true  # Enable serverless mode
bun run src/main.ts index              # Update search index
bun run src/main.ts embed              # Generate embeddings
```

## Frontend Development

```sh
cd src/web/app && bun install && bun run dev    # Vite dev server (proxies /api to :3000)
cd src/web/app && bun run build                 # Production build
```

## Testing

```sh
bun test                            # Run all tests
KNOTES_HOME=/tmp/test bun test      # Tests use temp KNOTES_HOME
```

## Conventions

- Use `Bun.file()` and `Bun.write()` for file I/O (not node:fs readFile/writeFile)
- Use `Bun.spawn()` for subprocesses
- All three interfaces (CLI, MCP, web) call into `src/core/router.ts` — not directly into notes/logs/search
- The server API (`src/web/api/`) calls core modules directly (it IS the server)
- Notes addressed by logical path without .md extension (e.g. `notes/projects/foo`)
- KNOTES_HOME env var sets storage root (default ~/.knotes)
- Config stored in SQLite (`.data/knotes.sqlite`), not settings.json
- Web server binds to 127.0.0.1 only — remote access via SSH forwarding or Tailscale
