# Jarvis Dashboard

A small live dashboard for the projects, backlogs, tasks, and notes you're
juggling — styled like an old blue-screen DOS TUI (Norton Commander / Turbo
Pascal), but modern. It's an **inbox you push to**: any Claude Code session (or
any shell, or `curl`) sends items in over HTTP, and the dashboard shows them as
a collapsible tree, auto-refreshing every 8 seconds.

## Structure

Three **areas** (lanes), each holding a collapsible tree:

```
LIVE          → shipped / running in production
IN PROGRESS   → actively being built   (default for new projects)
MOTHBALLED    → paused / archived

  AREA
   └── Project           (collapsible)
        ├── Sub-project  (collapsible)
        │    └── Task
        └── Task / Note / Blocker
```

Click a project's **area tag** to move it between lanes. Click a task's
**status badge** to cycle its status. Projects and sub-projects collapse with
`[+]` / `[−]`.

## Data model

Each item:

| field        | values                                              | default        |
| ------------ | --------------------------------------------------- | -------------- |
| `title`      | required for tasks/notes                             | —              |
| `kind`       | `project · subproject · task · note · blocker`       | `task`         |
| `project`    | name of parent project (auto-created if missing)     | —              |
| `subproject` | name of parent sub-project under `project`           | —              |
| `area`       | `live · in_progress · mothballed` (on the project)  | `in_progress`  |
| `status`     | `todo · in_progress · blocked · done`               | `todo`         |
| `priority`   | `low · normal · high · urgent`                       | `normal`       |
| `body`       | longer description (optional)                        | —              |
| `url`        | deep link to a PR / doc / task (optional)            | —              |
| `source`     | where it came from, e.g. `claude-code:my-repo`       | —              |

Projects and sub-projects are **auto-created** the first time you reference them
by name, so you usually just push tasks. Re-pushing the same project name with a
new `area` moves it. Storage is a local SQLite file (`./data/jarvis.db`).

## Run locally

```bash
cp .env.example .env        # then edit JARVIS_TOKEN
npm install
npm run dev                 # http://localhost:3000
# or production:  npm run build && npm start   (serves on :4500)
```

## Pushing items

### From any Claude Code session (recommended)

The helper reads its config from `~/.config/jarvis/jarvis.env` automatically, so
the one-time setup is just:

```bash
mkdir -p ~/.config/jarvis
printf 'JARVIS_URL=http://100.102.159.57:4500\nJARVIS_TOKEN=your-secret\n' \
  > ~/.config/jarvis/jarvis.env
chmod 600 ~/.config/jarvis/jarvis.env
alias jarvis-send="/path/to/jarvis-dashboard/scripts/jarvis-send.sh"   # optional
```

(You can still override with `JARVIS_URL` / `JARVIS_TOKEN` env vars.) A global
`~/.claude/CLAUDE.md` entry also tells future Claude Code sessions on this machine
how to push here when you say "add it to the backlog". Then, from anywhere:

```bash
jarvis-send "Wire up OAuth" --project prosecutor-platform --kind task --priority high
jarvis-send "Prisma migration blocks deploy" -p prosecutor-platform -k blocker -s blocked
jarvis-send "Export endpoint" -p prosecutor-platform --subproject discovery
jarvis-send "Idea: batch the discovery export" -p court-mock -k note
jarvis-send "court-mock" -k project --area live   # move a project to a lane
```

`source` defaults to `claude-code:<current-folder>` so you can see which repo a
note came from.

### From the Claude desktop app (regular chat)

A local MCP server (`mcp/jarvis-mcp.js`, zero dependencies) gives regular Claude
chat in the desktop app an `add_to_jarvis` and `list_jarvis` tool. It runs on
your Mac, so it reaches the dashboard over Tailscale — nothing is exposed
publicly. It's registered in `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "jarvis": {
      "command": "/usr/local/bin/node",
      "args": ["/path/to/jarvis-dashboard/mcp/jarvis-mcp.js"]
    }
  }
}
```

It reads the URL + token from `~/.config/jarvis/jarvis.env`. Restart the desktop
app after editing the config. (The browser web app can't reach a Tailscale
address, so this only works in the desktop app.)

### Raw curl (works from a Claude.ai chat too — just paste the snippet)

```bash
curl -X POST "$JARVIS_URL/api/items" \
  -H "content-type: application/json" \
  -H "x-jarvis-token: $JARVIS_TOKEN" \
  -d '{"title":"Ship the dashboard","project":"jarvis","kind":"task","priority":"high"}'
```

Batch insert with `{"items":[ {...}, {...} ]}`.

## API

| method   | route             | auth   | purpose                         |
| -------- | ----------------- | ------ | ------------------------------- |
| `GET`    | `/api/items`      | none   | list all items                  |
| `POST`   | `/api/items`      | token  | create one item or a batch      |
| `PATCH`  | `/api/items/:id`  | token  | update status/priority/fields   |
| `DELETE` | `/api/items/:id`  | token  | delete an item                  |

Token is sent as `x-jarvis-token: <token>` or `Authorization: Bearer <token>`.
If `JARVIS_TOKEN` is unset, writes are open (only do that on a trusted network).

## In the dashboard UI

- Click a **status badge** to cycle todo → in progress → blocked → done.
- Hover an item and click **✕** to delete.
- Bottom-right **🔑** sets the token this browser uses for status changes/deletes.
- Top bar: search + "hide done".
- **Environment banner:** set `JARVIS_ENV` (e.g. `dev`) and a non-production deploy
  shows an amber **`⚠ <ENV> ENVIRONMENT — NOT PRODUCTION`** strip pinned to the top
  and an `[ENV]` prefix in the browser-tab title. Leave it unset on production so no
  banner shows.
- **Live deployment status:** projects mapped to a known deployment (in
  `src/lib/deployments.ts`) show a green **`● LIVE`** / red **`○ DOWN`** badge in place
  of the manual lane control, and are auto-grouped into the LIVE lane. The status comes
  from `/api/health`, which pings each project's instance **for this dashboard's
  environment** — the DEV board (:4510) checks the dev instances, prod (:4500) the prod
  ones — so the two boards can legitimately differ (e.g. a dev instance down while prod
  is up). Untracked projects (e.g. not-yet-shipped work) keep their hand-set lane and ⇄.

## Deploy to the jarvis server

See `deploy/` for a systemd unit and notes. In short: `npm ci && npm run build`
on the server, then run `npm start` (port 4500) behind your reverse proxy.
