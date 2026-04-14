#!/usr/bin/env bash
# Generate/update the Homebrew formula after a release.
# Usage: ./scripts/update-formula.sh v0.4.0 [/path/to/homebrew-tap]
#
# Fetches per-platform release tarballs and generates the formula
# with correct URLs and SHA256 checksums.
set -euo pipefail

VERSION="${1:?Usage: $0 <version> [tap-dir]}"
TAG="${VERSION}"
VERSION_NUM="${VERSION#v}"
TAP_DIR="${2:-}"
REPO="antoninbas/knotes"

BASE_URL="https://github.com/${REPO}/releases/download/${TAG}"

fetch_sha() {
  local url="$1"
  local sha=""
  for attempt in 1 2 3 4 5 6; do
    sha=$(curl -fsSL "${url}" 2>/dev/null | shasum -a 256 | cut -d' ' -f1) && break
    echo "  Asset not ready yet, waiting 30s... (attempt ${attempt}/6)" >&2
    sleep 30
  done
  if [ -z "${sha}" ]; then
    echo "ERROR: Failed to download ${url} after retries" >&2
    exit 1
  fi
  echo "${sha}"
}

echo "Fetching checksums for ${TAG}..."

SHA_DARWIN_ARM64=$(fetch_sha "${BASE_URL}/knotes-${TAG}-darwin-arm64.tar.gz")
echo "  darwin-arm64: ${SHA_DARWIN_ARM64}"

SHA_DARWIN_X64=$(fetch_sha "${BASE_URL}/knotes-${TAG}-darwin-x64.tar.gz")
echo "  darwin-x64:   ${SHA_DARWIN_X64}"

SHA_LINUX_X64=$(fetch_sha "${BASE_URL}/knotes-${TAG}-linux-x64.tar.gz")
echo "  linux-x64:    ${SHA_LINUX_X64}"

FORMULA='class Knotes < Formula
  desc "Local-first note and activity log manager with hybrid search"
  homepage "https://github.com/'"${REPO}"'"
  version "'"${VERSION_NUM}"'"
  license "MIT"

  on_macos do
    on_arm do
      url "'"${BASE_URL}/knotes-${TAG}-darwin-arm64.tar.gz"'"
      sha256 "'"${SHA_DARWIN_ARM64}"'"
    end
    on_intel do
      url "'"${BASE_URL}/knotes-${TAG}-darwin-x64.tar.gz"'"
      sha256 "'"${SHA_DARWIN_X64}"'"
    end
  end

  on_linux do
    url "'"${BASE_URL}/knotes-${TAG}-linux-x64.tar.gz"'"
    sha256 "'"${SHA_LINUX_X64}"'"
  end

  def install
    libexec.install Dir["lib/knotes/*"]
    (bin/"knotes").write <<~SH
      #!/bin/sh
      exec "#{libexec}/bun" run "#{libexec}/src/main.ts" "$@"
    SH
  end

  service do
    run [bin/"knotes", "server"]
    keep_alive true
    log_path var/"log/knotes.log"
    error_log_path var/"log/knotes.log"
  end

  def caveats
    <<~EOS
      To start knotes as a background service:
        brew services start knotes

      The server runs on port 7713 by default (configurable with `knotes config set webPort <port>`).

      Data is stored in ~/.knotes by default. To use a custom directory,
      set KNOTES_HOME in your shell profile:
        export KNOTES_HOME=/path/to/data
    EOS
  end

  test do
    assert_match "knotes", shell_output("#{bin}/knotes --help")
  end
end'

if [ -n "${TAP_DIR}" ]; then
  mkdir -p "${TAP_DIR}/Formula"
  echo "${FORMULA}" > "${TAP_DIR}/Formula/knotes.rb"
  echo "Formula written to ${TAP_DIR}/Formula/knotes.rb"
else
  echo ""
  echo "${FORMULA}"
fi
