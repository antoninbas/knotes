#!/usr/bin/env bash
# Generate/update the Homebrew formula after a release.
# Usage: ./scripts/update-formula.sh v0.1.0 [/path/to/homebrew-tap]
set -euo pipefail

VERSION="${1:?Usage: $0 <version> [tap-dir]}"
TAG="${VERSION}"
VERSION_NUM="${VERSION#v}"
TAP_DIR="${2:-}"
REPO="antoninbas/knotes"

BASE_URL="https://github.com/${REPO}/releases/download/${TAG}"

echo "Fetching checksums for ${TAG}..."

sha_darwin_arm64=$(curl -sL "${BASE_URL}/knotes-darwin-arm64.tar.gz" | shasum -a 256 | cut -d' ' -f1)
sha_darwin_x64=$(curl -sL "${BASE_URL}/knotes-darwin-x64.tar.gz" | shasum -a 256 | cut -d' ' -f1)
sha_linux_x64=$(curl -sL "${BASE_URL}/knotes-linux-x64.tar.gz" | shasum -a 256 | cut -d' ' -f1)

echo "  darwin-arm64: ${sha_darwin_arm64}"
echo "  darwin-x64:   ${sha_darwin_x64}"
echo "  linux-x64:    ${sha_linux_x64}"

FORMULA='class Knotes < Formula
  desc "Local-first note and activity log manager with hybrid search"
  homepage "https://github.com/'"${REPO}"'"
  version "'"${VERSION_NUM}"'"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "'"${BASE_URL}"'/knotes-darwin-arm64.tar.gz"
      sha256 "'"${sha_darwin_arm64}"'"
    else
      url "'"${BASE_URL}"'/knotes-darwin-x64.tar.gz"
      sha256 "'"${sha_darwin_x64}"'"
    end
  end

  on_linux do
    url "'"${BASE_URL}"'/knotes-linux-x64.tar.gz"
    sha256 "'"${sha_linux_x64}"'"
  end

  def install
    if Hardware::CPU.arm? && OS.mac?
      bin.install "knotes-darwin-arm64" => "knotes"
    elsif OS.mac?
      bin.install "knotes-darwin-x64" => "knotes"
    else
      bin.install "knotes-linux-x64" => "knotes"
    end
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
