#!/usr/bin/env bash
# Build release tarballs for all platforms from a single Linux machine.
# Cross-compilation: installs deps for Linux, then swaps native binaries
# for each target platform (all native deps ship prebuilt binaries on npm).
#
# Usage: ./scripts/build-release.sh <version>
set -euo pipefail

VERSION="${1:?Usage: $0 <version>}"
VERSION_NUM="${VERSION#v}"
BUN_VERSION="$(bun --version)"

PLATFORMS=("linux-x64" "darwin-arm64" "darwin-x64")

# Maps our platform names to bun download names
declare -A BUN_PLATFORM_MAP=(
  ["linux-x64"]="linux-x64"
  ["darwin-arm64"]="darwin-aarch64"
  ["darwin-x64"]="darwin-x64"
)

# Maps our platform names to @node-llama-cpp package names
declare -A LLAMA_PKG_MAP=(
  ["linux-x64"]="linux-x64"
  ["darwin-arm64"]="mac-arm64-metal"
  ["darwin-x64"]="mac-x64"
)

# Maps our platform names to sqlite-vec package names
declare -A SQLVEC_PKG_MAP=(
  ["linux-x64"]="sqlite-vec-linux-x64"
  ["darwin-arm64"]="sqlite-vec-darwin-arm64"
  ["darwin-x64"]="sqlite-vec-darwin-x64"
)

# Maps our platform names to better-sqlite3 prebuild platform names
declare -A BSQL_PLATFORM_MAP=(
  ["linux-x64"]="linux-x64"
  ["darwin-arm64"]="darwin-arm64"
  ["darwin-x64"]="darwin-x64"
)

rm -rf dist
mkdir -p dist/bun-cache

# --- Step 1: Install deps and build frontend (once) ---

echo "Installing dependencies..."
bun install --frozen-lockfile
cd src/web/app && bun install --frozen-lockfile && cd ../../..

echo "Building frontend..."
cd src/web/app && bun run build && cd ../../..

# Get versions of native deps for cross-fetch
LLAMA_VERSION=$(python3 -c "import json; print(json.load(open('node_modules/node-llama-cpp/package.json'))['optionalDependencies']['@node-llama-cpp/linux-x64'])")
SQLVEC_VERSION=$(python3 -c "import json; print(json.load(open('node_modules/@tobilu/qmd/package.json'))['optionalDependencies']['sqlite-vec-linux-x64'])")
BSQL_VERSION=$(python3 -c "import json; print(json.load(open('node_modules/better-sqlite3/package.json'))['version'])")
NODE_ABI=$(bun -e "console.log(process.versions.modules)")

echo "Native dep versions: llama=${LLAMA_VERSION} sqlite-vec=${SQLVEC_VERSION} better-sqlite3=${BSQL_VERSION} node-abi=${NODE_ABI}"

# --- Step 2: Download bun binaries for all platforms ---

for platform in "${PLATFORMS[@]}"; do
  bun_plat="${BUN_PLATFORM_MAP[$platform]}"
  cache="dist/bun-cache/${platform}"
  if [ -f "${cache}" ]; then continue; fi

  if [ "${platform}" = "linux-x64" ]; then
    # Use the local bun binary
    cp "$(command -v bun)" "${cache}"
  else
    echo "Downloading bun ${BUN_VERSION} for ${platform}..."
    url="https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/bun-${bun_plat}.zip"
    curl -fsSL "${url}" -o "dist/bun-cache/${platform}.zip"
    unzip -qo "dist/bun-cache/${platform}.zip" -d "dist/bun-cache/"
    mv "dist/bun-cache/bun-${bun_plat}/bun" "${cache}"
    rm -rf "dist/bun-cache/bun-${bun_plat}" "dist/bun-cache/${platform}.zip"
  fi
done

# --- Step 3: Build tarball for each platform ---

for platform in "${PLATFORMS[@]}"; do
  echo ""
  echo "=== Building knotes ${VERSION} for ${platform} ==="

  DIST_NAME="knotes-${VERSION}-${platform}"
  DIST_DIR="dist/${DIST_NAME}"

  mkdir -p "${DIST_DIR}/lib/knotes" "${DIST_DIR}/bin"

  # Copy source and dependencies
  cp -r src package.json bun.lock node_modules "${DIST_DIR}/lib/knotes/"
  echo "${VERSION_NUM}" > "${DIST_DIR}/lib/knotes/VERSION"

  # Remove frontend node_modules (only needed at build time)
  rm -rf "${DIST_DIR}/lib/knotes/src/web/app/node_modules"

  NM="${DIST_DIR}/lib/knotes/node_modules"

  # --- Swap native binaries for target platform ---

  # @node-llama-cpp: remove all variants, install the right one
  rm -rf "${NM}/@node-llama-cpp"
  mkdir -p "${NM}/@node-llama-cpp"
  llama_pkg="@node-llama-cpp/${LLAMA_PKG_MAP[$platform]}"
  echo "  Fetching ${llama_pkg}@${LLAMA_VERSION}..."
  tarball_url=$(npm view "${llama_pkg}@${LLAMA_VERSION}" dist.tarball 2>/dev/null)
  curl -fsSL "${tarball_url}" | tar xz -C "${NM}/@node-llama-cpp"
  mv "${NM}/@node-llama-cpp/package" "${NM}/@node-llama-cpp/${LLAMA_PKG_MAP[$platform]}"

  # sqlite-vec: remove all variants, install the right one
  rm -rf "${NM}"/sqlite-vec-{darwin,linux,windows}-*
  sqlvec_pkg="${SQLVEC_PKG_MAP[$platform]}"
  echo "  Fetching ${sqlvec_pkg}@${SQLVEC_VERSION}..."
  tarball_url=$(npm view "${sqlvec_pkg}@${SQLVEC_VERSION}" dist.tarball 2>/dev/null)
  curl -fsSL "${tarball_url}" | tar xz -C "${NM}"
  mv "${NM}/package" "${NM}/${sqlvec_pkg}"

  # better-sqlite3: download the correct prebuilt .node binary
  bsql_plat="${BSQL_PLATFORM_MAP[$platform]}"
  prebuild_name="better-sqlite3-v${BSQL_VERSION}-node-v${NODE_ABI}-${bsql_plat}.tar.gz"
  prebuild_url="https://github.com/WiseLibs/better-sqlite3/releases/download/v${BSQL_VERSION}/${prebuild_name}"
  echo "  Fetching better-sqlite3 prebuild for ${bsql_plat}..."
  rm -rf "${NM}/better-sqlite3/build"
  curl -fsSL "${prebuild_url}" | tar xz -C "${NM}/better-sqlite3"

  # --- Prune unnecessary files ---

  # Dev-only packages
  for pkg in typescript bun-types @types prettier; do
    rm -rf "${NM}/${pkg}"
  done

  # tree-sitter: remove native build dirs (qmd uses wasm)
  for dir in "${NM}"/tree-sitter-*/build; do
    rm -rf "$dir"
  done

  # Test/doc directories
  find "${NM}" -maxdepth 3 \( -name "test" -o -name "tests" -o -name "docs" -o -name "example" -o -name "examples" \) -type d -exec rm -rf {} + 2>/dev/null || true

  # --- Add bun binary and wrapper ---

  cp "dist/bun-cache/${platform}" "${DIST_DIR}/lib/knotes/bun"
  chmod +x "${DIST_DIR}/lib/knotes/bun"

  cat > "${DIST_DIR}/bin/knotes" <<'WRAPPER'
#!/bin/sh
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec "${SCRIPT_DIR}/../lib/knotes/bun" run "${SCRIPT_DIR}/../lib/knotes/src/main.ts" "$@"
WRAPPER
  chmod +x "${DIST_DIR}/bin/knotes"

  # --- Create tarball ---

  echo "  Creating tarball..."
  cd dist
  tar czf "${DIST_NAME}.tar.gz" "${DIST_NAME}"
  rm -rf "${DIST_NAME}"
  cd ..

  SIZE=$(du -h "dist/${DIST_NAME}.tar.gz" | cut -f1)
  echo "  Built dist/${DIST_NAME}.tar.gz (${SIZE})"
done

# Cleanup
rm -rf dist/bun-cache

echo ""
echo "All tarballs built:"
ls -lh dist/*.tar.gz
