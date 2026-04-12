# Releasing

## Prerequisites

- `gh` CLI authenticated (`gh auth login`)
- Homebrew tap repo cloned at `~/homebrew-tap`

## Steps

1. Bump the `version` field in `package.json`
2. Commit the version bump
3. Run `make release` — builds binaries for all platforms, creates a GitHub release with tarballs
4. Update the Homebrew formula:
   ```bash
   ./scripts/update-formula.sh v<version> ~/homebrew-tap
   ```
5. Commit and push the tap repo:
   ```bash
   cd ~/homebrew-tap && git add -A && git commit -m "Update knotes to v<version>" && git push
   ```

## What `make release` does

1. Builds the frontend (`src/web/app`)
2. Embeds frontend assets into the binary
3. Cross-compiles standalone binaries for:
   - `linux-x64`
   - `darwin-arm64` (Apple Silicon)
   - `darwin-x64` (Intel Mac)
4. Packages each binary as a `.tar.gz`
5. Creates a GitHub release with auto-generated notes and uploads the tarballs

## What `update-formula.sh` does

1. Downloads each tarball from the GitHub release
2. Computes SHA256 checksums
3. Writes `Formula/knotes.rb` in the tap repo with the correct URLs and checksums

## Installation (end user)

```bash
brew tap antoninbas/tap
brew install knotes
```
