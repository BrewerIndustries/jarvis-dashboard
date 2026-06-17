#!/usr/bin/env bash
# jarvis-send — push an item to the Jarvis dashboard from any shell / Claude Code.
#
# Config: reads JARVIS_URL + JARVIS_TOKEN from the environment, falling back to
# ~/.config/jarvis/jarvis.env (override path with $JARVIS_CONFIG). Set up once:
#   mkdir -p ~/.config/jarvis
#   printf 'JARVIS_URL=http://100.102.159.57:4500\nJARVIS_TOKEN=...\n' > ~/.config/jarvis/jarvis.env
#   chmod 600 ~/.config/jarvis/jarvis.env
#
# Usage:
#   jarvis-send "Wire up auth" --project prosecutor-platform --kind task --priority high
#   jarvis-send "DB migration is blocking deploy" -p prosecutor-platform -k blocker -s blocked
#   jarvis-send "Export endpoint" -p prosecutor-platform --subproject discovery --area live
#
# The project (and sub-project) are auto-created if they don't exist yet, and a
# new project lands in its --area (default: in_progress).
#
# Flags: -p/--project  --subproject  --area(live|in_progress|mothballed)
#        -k/--kind(project|subproject|task|note|blocker)
#        -s/--status(todo|in_progress|blocked|done)  --priority(low|normal|high|urgent)
#        -b/--body "..."   -u/--url "..."
set -euo pipefail

TITLE="${1:-}"; shift || true
[ -z "$TITLE" ] && { echo "usage: jarvis-send \"title\" [--project X --subproject Y --area live ...]" >&2; exit 1; }

PROJECT=""; SUBPROJECT=""; AREA=""; KIND="task"; STATUS="todo"; PRIORITY="normal"; BODY=""; URL=""
SOURCE="${JARVIS_SOURCE:-claude-code:$(basename "$PWD")}"

while [ $# -gt 0 ]; do
  case "$1" in
    -p|--project)    PROJECT="$2"; shift 2;;
    --subproject)    SUBPROJECT="$2"; shift 2;;
    --area)          AREA="$2"; shift 2;;
    -k|--kind)       KIND="$2"; shift 2;;
    -s|--status)     STATUS="$2"; shift 2;;
    --priority)      PRIORITY="$2"; shift 2;;
    -b|--body)       BODY="$2"; shift 2;;
    -u|--url)        URL="$2"; shift 2;;
    *) echo "unknown flag: $1" >&2; exit 1;;
  esac
done

# Fall back to the saved config for any var not already set in the environment.
CONFIG="${JARVIS_CONFIG:-$HOME/.config/jarvis/jarvis.env}"
if [ -f "$CONFIG" ]; then
  [ -z "${JARVIS_URL:-}" ]   && JARVIS_URL="$(sed -n 's/^JARVIS_URL=//p' "$CONFIG" | head -1)"
  [ -z "${JARVIS_TOKEN:-}" ] && JARVIS_TOKEN="$(sed -n 's/^JARVIS_TOKEN=//p' "$CONFIG" | head -1)"
fi

: "${JARVIS_URL:?set JARVIS_URL (env or ~/.config/jarvis/jarvis.env)}"

# Build JSON safely with jq if available, else a minimal escape.
if command -v jq >/dev/null 2>&1; then
  PAYLOAD=$(jq -n \
    --arg title "$TITLE" --arg project "$PROJECT" --arg subproject "$SUBPROJECT" \
    --arg area "$AREA" --arg kind "$KIND" --arg status "$STATUS" \
    --arg priority "$PRIORITY" --arg body "$BODY" --arg url "$URL" --arg source "$SOURCE" \
    '{title:$title, project:$project, subproject:$subproject, area:$area, kind:$kind,
      status:$status, priority:$priority, body:$body, url:$url, source:$source}
     | with_entries(select(.value != ""))')
else
  esc() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }
  PAYLOAD="{\"title\":\"$(esc "$TITLE")\",\"project\":\"$(esc "$PROJECT")\",\"subproject\":\"$(esc "$SUBPROJECT")\",\"area\":\"$AREA\",\"kind\":\"$KIND\",\"status\":\"$STATUS\",\"priority\":\"$PRIORITY\",\"body\":\"$(esc "$BODY")\",\"url\":\"$(esc "$URL")\",\"source\":\"$(esc "$SOURCE")\"}"
fi

curl -fsS -X POST "$JARVIS_URL/api/items" \
  -H "content-type: application/json" \
  -H "x-jarvis-token: ${JARVIS_TOKEN:-}" \
  -d "$PAYLOAD" >/dev/null && echo "→ sent to jarvis: $TITLE"
