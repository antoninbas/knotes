# Releasing

## Prerequisites

- `gh` CLI authenticated (`gh auth login`)
- Homebrew tap repo cloned at `~/homebrew-tap`

## Steps

1. Bump the `version` field in `package.json`
2. Commit the version bump
3. Run `make release` — creates a GitHub release from the current tag
4. Update the Homebrew formula:
   ```bash
   ./scripts/update-formula.sh v<version> ~/homebrew-tap
   ```
5. Commit and push the tap repo:
   ```bash
   cd ~/homebrew-tap && git add -A && git commit -m "Update knotes to v<version>" && git push
   ```

## What `make release` does

1. Creates a GitHub release with auto-generated notes
2. GitHub automatically attaches the source archive (`.tar.gz`)

## What `update-formula.sh` does

1. Downloads the source archive from the GitHub release
2. Computes the SHA256 checksum
3. Writes `Formula/knotes.rb` in the tap repo with the correct URL and checksum

## How the formula works

The Homebrew formula installs knotes from source:

1. `depends_on "oven-sh/bun/bun"` — ensures Bun is installed
2. Runs `bun install` to fetch dependencies
3. Builds the frontend (`bun run build` in `src/web/app`)
4. Copies source + `node_modules` to `libexec/`
5. Creates a wrapper script in `bin/knotes` that runs `bun run libexec/src/main.ts`

## Installation (end user)

```bash
brew tap antoninbas/tap
brew install knotes
```

## Local deployment

To deploy the currently checked-out version on this machine:

```bash
make deploy
```

This runs `make install` (builds frontend, copies source to `~/.local/lib/knotes`, creates wrapper script) and restarts the systemd service.
