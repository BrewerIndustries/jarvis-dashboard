#!/usr/bin/env bash
# Pull latest dev and redeploy the DEV dashboard on the jarvis server.
# Usage (on the server):  /opt/jarvis-dashboard-dev/deploy/update-dev.sh
# Or from your Mac:        ssh dan@100.102.159.57 /opt/jarvis-dashboard-dev/deploy/update-dev.sh
set -euo pipefail

cd /opt/jarvis-dashboard-dev

echo "→ fetching latest dev…"
git pull --ff-only

echo "→ installing deps…"
npm ci

echo "→ building…"
npm run build

echo "→ restarting DEV service…"
sudo systemctl restart jarvis-dashboard-dev

sleep 3
echo "✓ deployed $(git log -1 --pretty='%h %s') — service $(systemctl is-active jarvis-dashboard-dev) on :4510"
