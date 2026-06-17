#!/usr/bin/env bash
# Pull latest main and redeploy the dashboard on the jarvis server.
# Usage (on the server):  /opt/jarvis-dashboard/deploy/update.sh
# Or from your Mac:        ssh dan@100.102.159.57 /opt/jarvis-dashboard/deploy/update.sh
set -euo pipefail

cd /opt/jarvis-dashboard

echo "→ fetching latest main…"
git pull --ff-only

echo "→ installing deps…"
npm ci

echo "→ building…"
npm run build

echo "→ restarting service…"
sudo systemctl restart jarvis-dashboard

sleep 3
echo "✓ deployed $(git log -1 --pretty='%h %s') — service $(systemctl is-active jarvis-dashboard)"
