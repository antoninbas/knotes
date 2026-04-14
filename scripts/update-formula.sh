#!/usr/bin/env bash
# Generate/update the Homebrew formula after a release.
# Expects pre-packaged macOS tarballs built by CI to already exist on the release.
# Usage: ./scripts/update-formula.sh v0.1.0 [/path/to/homebrew-tap]
set -euo pipefail

VERSION="${1:?Usage: $0 <version> [tap-dir]}"
TAG="${VERSION}"
VERSION_NUM="${VERSION#v}"
TAP_DIR="${2:-}"
REPO="antoninbas/knotes"

ARM64_URL="https://github.com/${REPO}/releases/download/${TAG}/knotes-${VERSION_NUM}-darwin-arm64.tar.gz"
X64_URL="https://github.com/${REPO}/releases/download/${TAG}/knotes-${VERSION_NUM}-darwin-x64.tar.gz"

echo "Fetching checksum for arm64 tarball..."
sha_arm64=$(curl -sL "${ARM64_URL}" | shasum -a 256 | cut -d' ' -f1)
echo "  sha256 (arm64): ${sha_arm64}"

echo "Fetching checksum for x64 tarball..."
sha_x64=$(curl -sL "${X64_URL}" | shasum -a 256 | cut -d' ' -f1)
echo "  sha256 (x64):   ${sha_x64}"

FORMULA='class Knotes < Formula
  desc "Local-first note and activity log manager with hybrid search"
  homepage "https://github.com/'"${REPO}"'"
  license "MIT"

  on_arm do
    url "'"${ARM64_URL}"'"
    sha256 "'"${sha_arm64}"'"
  end

  on_intel do
    url "'"${X64_URL}"'"
    sha256 "'"${sha_x64}"'"
  end

  # Node is still required because tsx (bundled in node_modules) runs on Node.js
  depends_on "node"

  def install
    # Tarballs are pre-packaged by CI with native modules already compiled and
    # the frontend already built. No npm install or compilation needed here.
    libexec.install Dir["*"]

    (bin/"knotes").write <<~SH
      #!/bin/sh
      exec "#{libexec}/node_modules/.bin/tsx" "#{libexec}/src/main.ts" "$@"
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

      Or use the built-in service manager:
        knotes service install

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
