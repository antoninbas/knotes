# Knotes

A local-first note and activity log manager with hybrid search. Built with Bun.

## Features

- **Notes**: Create, edit, organize, and search markdown notes in a hierarchy
- **Activity Logs**: Keep timestamped journal entries in structured log files
- **Hybrid Search**: BM25 + vector + LLM-reranked search via [qmd](https://github.com/tobi/qmd)
- **Document Import**: Import PDF, DOCX, XLSX, and more via [markitdown](https://github.com/microsoft/markitdown)
- **Three Interfaces**: CLI, MCP server, and web app — all sharing one core
- **Local-first**: All data is plain markdown files, easy to backup with git/rsync

## Quick Start

```bash
# Install dependencies
bun install
cd src/web/app && bun install && cd ../../..

# Use the CLI
bun run src/main.ts note create notes/hello --title "Hello World"
bun run src/main.ts note show notes/hello
bun run src/main.ts log add logs/daily -m "Started using knotes"
bun run src/main.ts log list logs/daily

# Start the web UI
bun run src/main.ts web

# Start the MCP server (for Claude Desktop, etc.)
bun run src/main.ts mcp
```

## Storage

All data lives under `KNOTES_HOME` (defaults to `~/.knotes`):

```
~/.knotes/
├── .config/settings.json    # Settings
├── .data/index.sqlite       # Search index
├── notes/                   # Your notes (markdown)
└── logs/                    # Your logs/journals (markdown)
```

## License

MIT
