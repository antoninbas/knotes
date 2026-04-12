#!/usr/bin/env bash
# Deploy the currently checked-out version of knotes locally.
# Builds the binary, installs it to ~/.local/bin, and restarts the systemd service.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$ROOT_DIR"

echo "Building and installing knotes..."
make install

echo "Restarting knotes service..."
systemctl --user restart knotes.service

# Give it a moment to start
sleep 2

if systemctl --user is-active --quiet knotes.service; then
  echo "Deploy complete. Service is running."
  systemctl --user status knotes.service --no-pager
else
  echo "ERROR: Service failed to start."
  journalctl --user -u knotes.service -n 20 --no-pager
  exit 1
fi
