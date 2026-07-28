#!/usr/bin/env bash
# Refresh the shared project registry by reading each repo's .jarvis.json via the
# GitHub API. Intended to be run by cron on the jarvis server.
#
# The GitHub token (optional, but required to read PRIVATE-repo declarations) is read
# from ~/.config/jarvis/registry-sync.env (or /opt/jarvis/registry-sync.env) as
# `GITHUB_TOKEN=...`. Without it the sync still produces a complete registry from the
# built-in defaults + any PUBLIC repos' .jarvis.json — it just can't read private overrides.
#
# Writes each environment's registry from the matching branch (dev→dev, prod→main).
# The prod block self-activates once the registry pipeline is promoted to main.
set -uo pipefail

for envf in "$HOME/.config/jarvis/registry-sync.env" /opt/jarvis/registry-sync.env; do
  if [ -f "$envf" ]; then set -a; . "$envf"; set +a; break; fi
done

NODE="$(command -v node || echo /usr/bin/node)"

# DEV registry (reads dev branches) → dev dashboard
if [ -f /opt/jarvis-dashboard-dev/scripts/sync-registry.mjs ]; then
  JARVIS_REF=dev OUT=/opt/jarvis-dashboard-dev/data/registry.json \
    "$NODE" /opt/jarvis-dashboard-dev/scripts/sync-registry.mjs
fi

# PROD registry (reads main) → prod dashboard (activates once on main)
if [ -f /opt/jarvis-dashboard/scripts/sync-registry.mjs ]; then
  JARVIS_REF=main OUT=/opt/jarvis-dashboard/data/registry.json \
    "$NODE" /opt/jarvis-dashboard/scripts/sync-registry.mjs
fi
