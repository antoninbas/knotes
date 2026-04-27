#!/usr/bin/env bash
# Generate/update the Homebrew formula after a release.
# Usage: ./scripts/update-formula.sh v0.1.0 [/path/to/homebrew-tap]
set -euo pipefail

VERSION="${1:?Usage: $0 <version> [tap-dir]}"
TAG="${VERSION}"
VERSION_NUM="${VERSION#v}"
TAP_DIR="${2:-}"
REPO="antoninbas/knotes"

SOURCE_URL="https://github.com/${REPO}/archive/refs/tags/${TAG}.tar.gz"

echo "Fetching checksum for source tarball..."
sha=$(curl -sL "${SOURCE_URL}" | shasum -a 256 | cut -d' ' -f1)
echo "  sha256: ${sha}"

FORMULA='class Knotes < Formula
  desc "Local-first note and activity log manager with hybrid search"
  homepage "https://github.com/'"${REPO}"'"
  url "'"${SOURCE_URL}"'"
  sha256 "'"${sha}"'"
  license "MIT"

  depends_on "node"

  def install
    # Skip node-llama-cpp binary download (done lazily on first use of `knotes embed`)
    ENV["NODE_LLAMA_CPP_SKIP_DOWNLOAD"] = "1"
    # Point node-gyp to local Node.js headers so better-sqlite3 compiles without network access
    ENV["npm_config_nodedir"] = Formula["node"].opt_prefix.to_s

    system "npm", "install"
    cd "src/web/app" do
      system "npm", "install"
      system "npx", "vite", "build"
    end
    system "npm", "run", "build"
    system "npm", "prune", "--omit=dev"

    libexec.install "dist", "node_modules", "package.json"

    (bin/"knotes").write <<~SH
      #!/bin/sh
      KNOTES_BIN="#{bin}/knotes"
      export KNOTES_BIN
      KNOTES_INSTALL_METHOD=brew
      export KNOTES_INSTALL_METHOD
      exec "#{Formula["node"].opt_bin}/node" "#{libexec}/dist/main.js" "$@"
    SH
  end

  service do
    run [bin/"knotes", "server"]
    keep_alive crashed: true
    log_path var/"log/knotes.log"
    error_log_path var/"log/knotes.log"
    environment_variables PATH: std_service_path_env
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
