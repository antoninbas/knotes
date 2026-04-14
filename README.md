# Knotes

A local-first note and activity log manager with hybrid search.

- **Notes** -- Markdown notes organized in a free-form hierarchy
- **Activity logs** -- Timestamped journal entries in structured log files
- **Hybrid search** -- BM25 + vector + LLM-reranked search via [qmd](https://github.com/tobi/qmd)
- **Document import** -- PDF, DOCX, XLSX, and more via [markitdown](https://github.com/microsoft/markitdown)
- **Three interfaces** -- CLI, MCP server, and web app, all sharing one core
- **Local-first** -- All data is plain markdown files, easy to back up with git/rsync

## Requirements

- [Node.js](https://nodejs.org) v20+
- [markitdown](https://github.com/microsoft/markitdown) (optional, for document import): `pip install markitdown`

## Installation

### npm (recommended)

```bash
npm install -g @antoninbas/knotes
```

### Install script

```bash
curl -fsSL https://raw.githubusercontent.com/antoninbas/knotes/main/scripts/install.sh | bash
```

### Homebrew (macOS / Linux)

```bash
brew tap antoninbas/tap
brew install knotes
```

### From source

```bash
git clone <repo-url> && cd knotes
make install   # installs to ~/.local/bin/knotes
```

Requires Node.js v20+. `make install` fetches dependencies, builds the frontend, and creates a wrapper script.

## Quick start

Knotes uses a **server-centric architecture**: the server (`knotes server`) is the central hub, and CLI commands route through its HTTP API by default. Start the server first, then use the CLI or web UI.

```bash
# Start the server (web UI + API on http://localhost:7713)
npx tsx src/main.ts server

# In another terminal, use the CLI
npx tsx src/main.ts note create notes/hello --title "Hello World"
npx tsx src/main.ts note show notes/hello
npx tsx src/main.ts note edit notes/hello          # opens in $EDITOR

npx tsx src/main.ts log create logs/daily --title "Daily Log"
npx tsx src/main.ts log add logs/daily -m "Started using Knotes"
npx tsx src/main.ts log list logs/daily

npx tsx src/main.ts search "hello"
```

If you prefer not to run a server, enable **serverless mode**:

```bash
npx tsx src/main.ts config set serverless true
```

In serverless mode, CLI commands and the MCP server access the data files directly.

## CLI reference

### Notes

```bash
knotes note create <path> [-t <title>] [--tags <tags>] [-e]   # create (optionally open in editor)
knotes note edit <path>                                        # open in $EDITOR
knotes note show <path>                                        # display content
knotes note delete <path>                                      # delete
knotes note list [prefix]                                      # list notes/directories
knotes note mkdir <path>                                       # create a folder
```

### Logs

```bash
knotes log create <path> [-t <title>]                    # create a new log
knotes log add <path> [-m <message>]                     # add entry (opens $EDITOR if no -m)
knotes log list <path> [-l <limit>]                      # list entries
knotes log update <path> <entry-id> [-m <message>]       # update entry
knotes log delete <path> <entry-id>                      # delete entry
```

### Search

```bash
knotes search <query> [-l <limit>] [-m <mode>]    # search (mode: hybrid, bm25, vector)
knotes index [--force]                             # update search index
knotes embed [--force]                             # generate embeddings for vector search
```

The search index is updated automatically on every note/log operation. Embeddings need to be generated separately via `knotes embed` or the web UI. The server runs a background embed job periodically (default: every 5 minutes, configurable).

### Import

```bash
knotes import <file> [--to <path>]    # import PDF/DOCX/etc. as a markdown note
```

Requires [markitdown](https://github.com/microsoft/markitdown) (`pip install markitdown`).

### Server

```bash
knotes server [-p <port>]    # start server (web UI + API, default port 7713)
```

The web server binds to `127.0.0.1` only. For remote access, use [Tailscale](https://tailscale.com) or SSH port forwarding (see [docs/tailscale-setup.md](docs/tailscale-setup.md)).

### Service management

Run the server as a background service that starts automatically on boot:

```bash
knotes service install                        # install and start
knotes service install --port 8080            # custom port
knotes service install --home /data/knotes    # custom KNOTES_HOME
knotes service status                         # check if running
knotes service logs [-f]                      # view logs (optionally follow)
knotes service uninstall                      # stop and remove
```

On macOS this creates a launchd agent (`~/Library/LaunchAgents/com.knotes.server.plist`). On Linux it creates a systemd user service (`~/.config/systemd/user/knotes.service`).

If you set a custom `--home`, you must also export `KNOTES_HOME` in your shell profile for the CLI to access the same data:

```bash
echo 'export KNOTES_HOME=/data/knotes' >> ~/.bashrc
```

### MCP server

```bash
knotes mcp                  # start MCP server (stdio transport)
knotes mcp --read-only      # read-only mode (no create/update/delete tools)
```

For use with Claude Desktop, Cursor, and other MCP-compatible clients. Example Claude Desktop config:

```json
{
  "mcpServers": {
    "knotes": {
      "command": "npx",
      "args": ["tsx", "/path/to/knotes/src/main.ts", "mcp"]
    }
  }
}
```

### Configuration

```bash
knotes config show [--json]              # display current config
knotes config edit                       # edit config in $EDITOR
knotes config set <key> <value>          # set a value
knotes config get <key>                  # get a value
```

Configuration keys:

| Key | Default | Description |
|-----|---------|-------------|
| `editor` | `$EDITOR` or `vi` | Editor for `note edit` and `log add` |
| `webPort` | `7713` | Server port |
| `theme` | `system` | Web UI theme (`light`, `dark`, `system`) |
| `embedInterval` | `300` | Background embed interval in seconds |
| `serverless` | `false` | Skip server, access files directly |

## Storage

All data lives under `KNOTES_HOME` (defaults to `~/.knotes`):

```
~/.knotes/
├── .data/
│   ├── knotes.sqlite       # Config and server state
│   └── index.sqlite        # Search index (managed by qmd)
├── notes/                   # Markdown notes (free hierarchy)
│   └── projects/
│       └── foo.md
└── logs/                    # Log/journal files (markdown)
    └── daily.md
```

Notes and logs are plain markdown files with YAML frontmatter (`title`, `created`, `modified`, `tags`, `type`). They are addressed by logical path without the `.md` extension (e.g. `notes/projects/foo`).

### Log entry format

Log entries are stored as H2 headings with an ISO timestamp and a short hex ID:

```markdown
## 2026-04-10T21:00:00Z {#e-3f7a}

Entry content here. Free-form markdown.

## 2026-04-10T14:30:00Z {#e-2b4c}

Older entry. Newest first.
```

## Development

```bash
make dev          # install deps, type-check, build frontend, start server
make dev-web      # Vite dev server with HMR (proxies /api to :7713)
make test         # run tests
make check        # type-check all code
make fmt          # format with Prettier
make deploy       # deploy current checkout locally (install + restart service)
```

## Architecture

```
src/main.ts           # Single entrypoint, dispatches to CLI/MCP/server
src/core/             # Shared business logic
  router.ts           # Routes to server (HTTP) or direct (core) based on mode
  client.ts           # HTTP client, mirrors core API
  db.ts               # SQLite state DB (config, heartbeat, jobs)
  config.ts           # Config resolution
  notes.ts            # Note CRUD
  logs.ts             # Log entry CRUD
  search.ts           # Search facade over qmd
  importer.ts         # markitdown subprocess wrapper
src/cli/              # Commander-based CLI
src/mcp/              # MCP server (stdio transport)
src/web/
  server.ts           # Hono server, heartbeat, background embed
  api/                # REST routes (notes, logs, search)
  app/                # SolidJS + Tailwind CSS v4 frontend (built with Vite)
```

## License

MIT
