# Knotes

Local-first note and activity log manager with hybrid search. Built with Bun.

## Tech Stack

- **Runtime**: Bun
- **Backend**: Hono (web server), Commander (CLI), MCP SDK (MCP server)
- **Frontend**: SolidJS + Tailwind CSS v4 (built with Vite, needed for solid-js JSX transform)
- **Search**: @tobilu/qmd (BM25 + vector + hybrid)
- **Document import**: markitdown (Python CLI, called via Bun.spawn)

## Project Structure

- `src/core/` — Shared business logic (config, notes, logs, search, importer)
- `src/cli/` — Commander-based CLI (commands in `commands/`)
- `src/mcp/` — MCP server (stdio transport)
- `src/web/` — Hono API (`api/`) + SolidJS frontend (`app/`)
- `src/main.ts` — Single entrypoint

## Commands

```sh
bun run src/main.ts --help          # CLI help
bun run src/main.ts web             # Start web server
bun run src/main.ts mcp             # Start MCP server
KNOTES_HOME=/tmp/test bun run src/main.ts note create notes/foo  # Test with temp home
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
- All three interfaces (CLI, MCP, web) call into `src/core/` — never directly access files
- Notes addressed by logical path without .md extension (e.g. `notes/projects/foo`)
- KNOTES_HOME env var sets storage root (default ~/.knotes)
