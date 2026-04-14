#!/usr/bin/env bash
# Generate/update the Homebrew formula after a release.
# Usage: ./scripts/update-formula.sh v0.1.0 [/path/to/homebrew-tap]
set -euo pipefail

VERSION="${1:?Usage: $0 <version> [tap-dir]}"
TAG="${VERSION}"
VERSION_NUM="${VERSION#v}"
TAP_DIR="${2:-}"
REPO="antoninbas/knotes"

ARCHIVE_URL="https://github.com/${REPO}/archive/refs/tags/${TAG}.tar.gz"

echo "Fetching checksum for ${TAG}..."
sha=$(curl -sL "${ARCHIVE_URL}" | shasum -a 256 | cut -d' ' -f1)
echo "  sha256: ${sha}"

FORMULA='class Knotes < Formula
  desc "Local-first note and activity log manager with hybrid search"
  homepage "https://github.com/'"${REPO}"'"
  url "'"${ARCHIVE_URL}"'"
  sha256 "'"${sha}"'"
  license "MIT"

  depends_on "node"

  def install
    system "npm", "install", "--production"
    cd "src/web/app" do
      system "npm", "install"
      system "npx", "vite", "build"
    end

    libexec.install Dir["src", "package.json", "package-lock.json", "node_modules"]
    # Frontend node_modules needed for the built assets path resolution
    (libexec/"src/web/app/node_modules").install Dir["src/web/app/node_modules/*"] if Dir.exist?("src/web/app/node_modules")

    (bin/"knotes").write <<~SH
      #!/bin/sh
      exec npx tsx "#{libexec}/src/main.ts" "$@"
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
