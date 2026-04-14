#!/usr/bin/env bash
# Install knotes — a local-first note and activity log manager.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/antoninbas/knotes/main/scripts/install.sh | bash
#   curl -fsSL ... | bash -s -- --prefix ~/.local --npm --version v0.4.0
#
# Flags:
#   --prefix DIR       Install location (default: $HOME/.local)
#   --global           System-wide install (prefix=/usr/local, may need sudo)
#   --npm              Force npm/npx even if bun is available
#   --version VERSION  Install a specific version (default: latest release)
#   --local            Install from current directory (for development/CI)
#   --help             Show this help message
set -euo pipefail

REPO="antoninbas/knotes"
PREFIX=""
USE_NPM=false
VERSION=""
LOCAL=false

# ── Parse arguments ──────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
  case "$1" in
    --prefix)
      PREFIX="$2"
      shift 2
      ;;
    --global)
      PREFIX="/usr/local"
      shift
      ;;
    --npm)
      USE_NPM=true
      shift
      ;;
    --version)
      VERSION="$2"
      shift 2
      ;;
    --local)
      LOCAL=true
      shift
      ;;
    --help|-h)
      head -14 "$0" | tail -11
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

# Default prefix
if [[ -z "${PREFIX}" ]]; then
  PREFIX="${HOME}/.local"
fi

# ── Detect OS ────────────────────────────────────────────────────

OS="$(uname -s)"
case "${OS}" in
  Linux|Darwin) ;;
  *)
    echo "Error: Unsupported operating system: ${OS}"
    exit 1
    ;;
esac

# ── Detect or install package manager ────────────────────────────

PKG_INSTALL=""
PKG_RUN=""

if [[ "${USE_NPM}" == true ]]; then
  if command -v npm &>/dev/null; then
    PKG_INSTALL="npm"
    PKG_RUN="npx"
  elif command -v node &>/dev/null; then
    echo "Node.js found but npm is missing. Installing npm..."
    echo "Please install npm manually or use --npm without this flag."
    exit 1
  else
    echo "Node.js is not installed. Installing via official script..."
    # Install Node.js via nvm
    if ! command -v nvm &>/dev/null; then
      curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
      export NVM_DIR="${HOME}/.nvm"
      # shellcheck source=/dev/null
      [ -s "${NVM_DIR}/nvm.sh" ] && . "${NVM_DIR}/nvm.sh"
    fi
    nvm install --lts
    nvm use --lts
    PKG_INSTALL="npm"
    PKG_RUN="npx"
  fi
else
  # Default: prefer bun
  if command -v bun &>/dev/null; then
    PKG_INSTALL="bun"
    PKG_RUN="bunx"
  elif command -v npm &>/dev/null; then
    PKG_INSTALL="npm"
    PKG_RUN="npx"
  else
    echo "No package manager found. Installing bun..."
    curl -fsSL https://bun.sh/install | bash
    export BUN_INSTALL="${HOME}/.bun"
    export PATH="${BUN_INSTALL}/bin:${PATH}"
    PKG_INSTALL="bun"
    PKG_RUN="bunx"
  fi
fi

echo "Using package manager: ${PKG_INSTALL}"

# ── Determine version and source ────────────────────────────────

if [[ "${LOCAL}" == true ]]; then
  # Install from current directory
  VERSION="${VERSION:-local}"
  echo "Installing knotes ${VERSION} from local source..."
  SOURCE_DIR="$(pwd)"
else
  if [[ -z "${VERSION}" ]]; then
    echo "Fetching latest release..."
    VERSION=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name"' | sed -E 's/.*"tag_name": *"([^"]+)".*/\1/')
    if [[ -z "${VERSION}" ]]; then
      echo "Error: Could not determine latest release version."
      exit 1
    fi
  fi

  echo "Installing knotes ${VERSION}..."

  TMPDIR=$(mktemp -d)
  trap 'rm -rf "${TMPDIR}"' EXIT

  TARBALL_URL="https://github.com/${REPO}/archive/refs/tags/${VERSION}.tar.gz"
  echo "Downloading ${TARBALL_URL}..."
  curl -fsSL "${TARBALL_URL}" | tar xz -C "${TMPDIR}"

  # GitHub tarballs extract to repo-name-version/
  EXTRACTED_DIR="${TMPDIR}/knotes-${VERSION#v}"
  if [[ ! -d "${EXTRACTED_DIR}" ]]; then
    # Try alternate naming
    EXTRACTED_DIR=$(ls -d "${TMPDIR}"/knotes-* 2>/dev/null | head -1)
    if [[ -z "${EXTRACTED_DIR}" || ! -d "${EXTRACTED_DIR}" ]]; then
      echo "Error: Could not find extracted source directory."
      exit 1
    fi
  fi

  SOURCE_DIR="${EXTRACTED_DIR}"
fi

cd "${SOURCE_DIR}"

# ── Install dependencies and build ──────────────────────────────

if [[ "${LOCAL}" == true ]]; then
  # Local mode: install deps and build in a copy to avoid modifying the source tree
  TMPDIR=$(mktemp -d)
  trap 'rm -rf "${TMPDIR}"' EXIT
  INSTALL_SRC="${TMPDIR}/knotes"
  cp -r "${SOURCE_DIR}" "${INSTALL_SRC}"
  cd "${INSTALL_SRC}"
fi

echo "Installing dependencies..."
if [[ "${PKG_INSTALL}" == "bun" ]]; then
  bun install --production
else
  npm install --omit=dev
fi

# Build the frontend
echo "Building frontend..."
cd src/web/app
if [[ "${PKG_INSTALL}" == "bun" ]]; then
  bun install
  ${PKG_RUN} vite build
else
  npm install
  ${PKG_RUN} vite build
fi
cd ../../..

# Remove frontend dev dependencies after build
rm -rf src/web/app/node_modules

# ── Install to prefix ───────────────────────────────────────────

LIBDIR="${PREFIX}/lib/knotes"
BINDIR="${PREFIX}/bin"

# Check if we need sudo
SUDO=""
if [[ ! -w "${PREFIX}" ]] 2>/dev/null; then
  if [[ "${PREFIX}" == "/usr/local" || "${PREFIX}" == "/usr" ]]; then
    SUDO="sudo"
  else
    mkdir -p "${PREFIX}" 2>/dev/null || SUDO="sudo"
  fi
fi

echo "Installing to ${LIBDIR}..."
${SUDO} mkdir -p "${LIBDIR}" "${BINDIR}"

# Clean previous install
${SUDO} rm -rf "${LIBDIR}"
${SUDO} mkdir -p "${LIBDIR}"

# Copy source and dependencies
${SUDO} cp -r src package.json node_modules "${LIBDIR}/"
echo "${VERSION#v}" | ${SUDO} tee "${LIBDIR}/VERSION" > /dev/null

# Create wrapper script
${SUDO} tee "${BINDIR}/knotes" > /dev/null <<WRAPPER
#!/bin/sh
exec ${PKG_RUN} tsx "\$(dirname "\$(readlink -f "\$0")")/../lib/knotes/src/main.ts" "\$@"
WRAPPER
${SUDO} chmod +x "${BINDIR}/knotes"

# ── Success message ──────────────────────────────────────────────

VERSION_NUM="${VERSION#v}"

echo ""
echo "============================================"
echo "  knotes ${VERSION_NUM} installed successfully!"
echo "============================================"
echo ""
echo "  Location: ${LIBDIR}"
echo "  Binary:   ${BINDIR}/knotes"
echo ""

# Check if bin dir is in PATH
if ! echo "${PATH}" | tr ':' '\n' | grep -qx "${BINDIR}"; then
  echo "  Add to your PATH:"
  echo "    export PATH=\"${BINDIR}:\$PATH\""
  echo ""
  echo "  Add this line to your shell profile (~/.bashrc, ~/.zshrc, etc.)"
  echo ""
fi

echo "  Get started:"
echo "    knotes --help"
echo ""
echo "  Run as a server (web UI + API):"
echo "    knotes server"
echo ""
echo "  Install as a background service (auto-start on boot):"
echo "    knotes service install"
echo "    knotes service start"
echo ""
echo "  Documentation: https://github.com/${REPO}"
echo ""
