# Knotes

A local-first note and activity log manager with hybrid search.

- **Notes** -- Markdown notes organized in a free-form hierarchy
- **Activity logs** -- Timestamped journal entries in structured log files
- **Hybrid search** -- BM25 + vector + LLM-reranked search via [qmd](https://github.com/tobi/qmd)
- **Document import** -- PDF, DOCX, XLSX, and more via [markitdown](https://github.com/microsoft/markitdown)
- **Three interfaces** -- CLI, MCP server, and web app, all sharing one core
- **Local-first** -- All data is plain markdown files, easy to back up with git/rsync

## Requirements

- [Node.js](https://nodejs.org) v22+ or [Bun](https://bun.sh)
- [markitdown](https://github.com/microsoft/markitdown) (optional, for document import): `pip install markitdown`

## Installation

### npm

```bash
npm install -g @antoninbas/knotes
```

### Bun

```bash
bun install -g @antoninbas/knotes
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

Requires Node.js v22+. `make install` fetches dependencies, builds the frontend and backend, and installs a wrapper script.

## Quick start

Knotes uses a **server-centric architecture**: the server (`knotes server`) is the central hub, and CLI commands route through its HTTP API by default. Start the server first, then use the CLI or web UI.

```bash
# Start the server (web UI + API on http://localhost:7713)
npx tsx src/main.ts server

# In another terminal, use the CLI
npx tsx src/main.ts note create notes/hello --title "Hello World"
npx tsx src/main.ts note show notes/hello
npx tsx src/main.ts note edit notes/hello          # opens in $EDITOR

npx tsx src/main.ts log create-journal logs/daily --title "Daily Log"
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
knotes note get <path>                                         # display content (alias: show)
knotes note delete <path>                                      # delete
knotes note rename <from> <to> [--folder]                      # rename/move (same top-level)
knotes note list [prefix]                                      # list notes/directories
knotes note mkdir <path>                                       # create a folder
```

### Logs

Journals (the log document itself):

```bash
knotes log create-journal <path> [-t <title>] [-d <description>]   # create a journal
knotes log list-journals [prefix]                                   # list journals
knotes log update-journal <path> [-t <title>] [-d <description>]    # update title/description
knotes log rename-journal <from> <to>                               # rename/move a journal (under logs/)
knotes log delete-journal <path>                                    # delete a journal
```

Entries inside a journal:

```bash
knotes log add <path> [-m <message>]                               # add entry ($EDITOR if no -m)
knotes log list <path> [-l <limit>] [--since <date>] [--before <date>]   # list entries
knotes log update <path> <entry-id> [-m <message>]                 # update entry
knotes log delete <path> <entry-id>                                # delete entry
```

### Search

```bash
knotes search <query> [-l <limit>] [-m <mode>]                     # search (hybrid, bm25, vector)
                     [-c notes] [-c logs]                          # restrict collections (repeatable)
                     [--min-score <n>]                             # drop results below this score
                     [--rerank]                                    # LLM reranking (hybrid only, slow on CPU)
                     [--expand]                                    # LLM query expansion (hybrid only, slow)
knotes index [--force]                                             # update search index
knotes embed [--force]                                             # generate embeddings for vector search
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
      "command": "knotes",
      "args": ["mcp"]
    }
  }
}
```

### Search context hints

Context hints are short descriptions attached to folders or journals. qmd
uses them to bias search relevance for items in that path.

```bash
knotes context list                       # list all hints
knotes context get <path>                 # show the hint for a path
knotes context set <path> <description>   # set a hint
knotes context remove <path>              # clear the hint
```

Example:

```bash
knotes context set notes/projects "Engineering project notes and design docs"
knotes context set logs/standup "Daily standup notes from the infra team"
```

### GitHub integration

Connect a log journal to one or more GitHub accounts (github.com or
self-hosted GHES). The connected journal is filled in automatically with
log entries for opened/merged/closed PRs you authored, opened issues, and
PR reviews you submitted. Filters narrow activity by org or repo.

```bash
knotes github auth login [--host HOST] [--method device|pat|gh]
                         [--token T] [--client-id ID]
knotes github auth list
knotes github auth logout <host> <login>

knotes github connect <log-path>
                      --account <host>:<login>
                      --monitor opened-prs,merged-prs,issues,reviews
                      [--include-org ORG ...] [--exclude-repo OWNER/REPO ...]
                      [--since YYYY-MM-DD]                  # default: now - 7d
                      [--body title|full|first-paragraph|first-chars:N]
                                                            # default: title
knotes github list [<log-path>]
knotes github disconnect <connection-id>

knotes github sync [<log-path>] [--connection ID]   # one-off sync
knotes github status [--limit N]                     # recent sync jobs
knotes github cron-install [--interval MIN]         # serverless schedule snippet
```

Authentication:

- **`--method device` (default for github.com).** Standard GitHub Device
  Flow — knotes prints a short user code, you visit
  `https://github.com/login/device` and paste it. Works headless / over
  SSH. github.com uses a built-in OAuth App that ships with knotes; no
  extra setup. For **GHES**, every instance must have its own OAuth App
  registered (`https://<your-ghes-host>/settings/applications/new`,
  enable "Device Flow"); pass its id with `--client-id`.
- **`--method gh`.** Reuse credentials from your `gh` CLI install (shells
  out to `gh auth token --hostname HOST`). Zero-setup if your `gh` is
  already authenticated for that host.
- **`--method pat`.** Paste a Personal Access Token via `--token` or
  stdin. Works on github.com and any GHES instance. Useful when device
  flow isn't viable (locked-down corporate browsers, etc.).

Multi-account on the same host is supported: re-run `auth login` for
each identity. Two device-flow accounts on the same host can use
different `--client-id`s if you want to point them at different OAuth
Apps (e.g. personal vs. org-owned). The `client_id` is stored per
account.

Tokens are stored as plaintext in `$KNOTES_HOME/.data/knotes.sqlite` and
the file is `chmod 0600` on first open. Anyone with read access to that
file can read the tokens — back it up accordingly.

In server mode, the running server polls every `githubSyncInterval`
seconds (default 600). In serverless mode, run `knotes github sync` from
a cron job / launchd plist / systemd timer; `knotes github cron-install`
prints a ready-to-paste snippet for your platform.

`--body` controls how much of each PR / issue description ends up in the
log entry:

- `title` (default) — title and metadata only.
- `full` — entire body, quoted as a markdown blockquote.
- `first-paragraph` — body up to the first blank line, with a `> …`
  marker if anything was trimmed.
- `first-chars:N` — at most N characters, ellipsis if truncated.

Changing `--body` on an existing connection (re-run `knotes github
connect …`) will rewrite all matching entries on the next sync (the
state hash changes). Editing a PR or issue body on GitHub also rewrites
the corresponding entry on the next sync.

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
| `embedModel` | `""` (qmd default) | HuggingFace GGUF URI for the embedding model |
| `queryExpansionModel` | `""` (qmd default) | HuggingFace GGUF URI for the query-expansion LLM |
| `rerankModel` | `""` (qmd default) | HuggingFace GGUF URI for the reranker |
| `rerank` | `false` | Enable LLM reranking in hybrid search (slow on CPU) |
| `queryExpand` | `false` | Enable LLM query expansion in hybrid search (slow on CPU) |
| `githubEnabled` | `true` | Enable the background GitHub sync loop |
| `githubSyncInterval` | `600` | GitHub sync interval in seconds (server mode) |

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

Log entries are stored as H2 headings with an ISO timestamp and a 16-hex ID:

```markdown
## 2026-04-10T21:00:00Z {#e-3f7a9c1d2e4b6a80}

Entry content here. Free-form markdown.

## 2026-04-10T14:30:00Z {#e-2b4c1f3a8d5e7012}

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
  db.ts               # SQLite state DB (config, heartbeat, jobs, contexts)
  config.ts           # Config resolution
  notes.ts            # Note CRUD
  logs.ts             # Log entry CRUD
  search.ts           # Search facade over qmd
  context.ts          # Per-path search context hints
  importer.ts         # markitdown subprocess wrapper
src/cli/              # Commander-based CLI
src/mcp/              # MCP server (stdio transport)
src/web/
  server.ts           # Hono server, heartbeat, background embed
  api/                # REST routes (notes, logs, search, context)
  app/                # SolidJS + Tailwind CSS v4 frontend (built with Vite)
```

## License

MIT
