# Jarvis Dashboard — project context

A personal **project / backlog dashboard**. It's an inbox you push items to over
HTTP from any Claude session or shell; the UI shows them as a collapsible tree,
styled like an old blue-screen DOS TUI (Norton Commander), auto-refreshing every 8s.

- **Stack:** Next.js 16 + React 19 + Tailwind 4, SQLite via `better-sqlite3`. No external services.
- **Repo:** `BrewerIndustries/jarvis-dashboard` (private). This folder is the working copy.
- **Local path:** `~/Desktop/Jarvis/jarvis-dashboard` (a standalone repo that happens to live
  inside the Jarvis folder; the Jarvis repo `.gitignore`s it, so they don't interfere).

## Environments (both on the jarvis server, `dan@100.102.159.57`, over Tailscale)

| Env  | Branch | Path                       | Port | Service                | URL                          |
| ---- | ------ | -------------------------- | ---- | ---------------------- | ---------------------------- |
| DEV  | `dev`  | `/opt/jarvis-dashboard-dev` | 4510 | `jarvis-dashboard-dev` | http://100.102.159.57:4510   |
| MAIN | `main` | `/opt/jarvis-dashboard`     | 4500 | `jarvis-dashboard`     | http://100.102.159.57:4500   |

Each env is a git checkout (read-only deploy key `~/.ssh/jarvis-dashboard-deploy`,
SSH host alias `github-jarvis-dashboard`) with its **own `.env` (separate `JARVIS_TOKEN`)
and isolated SQLite DB**. `.env`, `data/`, `node_modules/`, `.next/` are gitignored —
server-only.

DEV's `.env` sets **`JARVIS_ENV=dev`**, which renders an amber "DEV ENVIRONMENT — NOT
PRODUCTION" banner at the top + `[DEV]` tab title. MAIN leaves it unset → no banner.
It's read server-side per request (the page is `force-dynamic`), so `.env` edit + service
restart suffices.

## Workflow  ⚠️ READ THIS

- **Work on `dev`.** Push to `dev` and deploy DEV freely.
- **Never merge/push/deploy `main` without the user's explicit permission.** `main` is
  production and holds the user's real data.

```bash
# develop on dev, then deploy DEV:
git push origin dev
ssh dan@100.102.159.57 /opt/jarvis-dashboard-dev/deploy/update-dev.sh    # → DEV (:4510)

# promote to production — ONLY when the user explicitly approves:
git checkout main && git merge --ff-only dev && git push origin main
ssh dan@100.102.159.57 /opt/jarvis-dashboard/deploy/update.sh            # → MAIN (:4500)
```

## Local development

```bash
npm install            # first time
npm run dev            # http://localhost:3000  (needs .env.local with JARVIS_TOKEN)
npm run build          # production build (run before deploying)
```

`.env.local` (gitignored) holds `JARVIS_TOKEN=test` for local dev. To verify UI
changes, use the preview tooling (a `.claude/launch.json` is included).

## Data model (one `items` table, hierarchy via `parentId`)

- `kind`: `project | subproject | task | note | blocker`
- `area` (lane, on projects): `live | in_progress | mothballed`  ← the columns
- `status` (tasks): `todo | in_progress | blocked | done`
- `priority`: `low | normal | high | urgent`
- also: `title`, `body` (description, editable inline for containers), `url`, `source`, `parentId`
- Projects/sub-projects auto-create by name on push.

## Architecture map

- `src/lib/db.ts` — SQLite + all create/list/update/delete + name-based auto-vivification
- `src/lib/types.ts` — kinds, areas, statuses, priorities, `Item`/`TreeItem`
- `src/lib/auth.ts` — token check for writes
- `src/app/api/items/route.ts` — `GET` (list) / `POST` (create, token-gated)
- `src/app/api/items/[id]/route.ts` — `PATCH` / `DELETE` (token-gated, delete cascades)
- `src/app/page.tsx` — server entry; resolves `JARVIS_ENV` and passes it to the UI + tab title
- `src/components/Dashboard.tsx` — the whole UI (tree, columns, collapse, inline edit, DOS theme, env banner)
- `src/app/globals.css` — DOS/CRT theme (CGA palette, scanlines, double-line boxes)
- `scripts/jarvis-send.sh` — CLI push helper (reads `~/.config/jarvis/jarvis.env`)
- `mcp/jarvis-mcp.js` — local MCP server for the Claude desktop app (`add_to_jarvis`, `list_jarvis`)
- `deploy/` — systemd units (`jarvis-dashboard.service`, `jarvis-dashboard-dev.service`),
  deploy scripts (`update.sh`, `update-dev.sh`), and `deploy/README.md`

## Pushing items (from other sessions)

- Any shell / Claude Code: `scripts/jarvis-send.sh "Title" -p project [--subproject X] [--area live] [-k task|note|blocker]`
- Raw: `POST {URL}/api/items` with header `x-jarvis-token: <token>`; body `{title, project, kind, ...}`
- Credentials live in `~/.config/jarvis/jarvis.env` (this points at MAIN/:4500 by default).

## Current status (2026-06-17)

Both environments deployed and healthy. The **DEV environment banner** shipped
(amber non-prod strip + `[DEV]` tab title, gated by `JARVIS_ENV`, hard-guarded off
the `:4500` prod port). DEV's `.env` now sets `JARVIS_ENV=dev`.

DEV is seeded with the full project list — **LIVE:** Jarvis, Jarvis Dashboard,
Jarvis Launcher, Space Base Race; **IN PROGRESS:** BPT 2.0, Stellar Ascent, Tessera
(with Court Mock + DEMS Mock sub-projects). Note: "Tessera" is the repo in the local
`Prosecuter Platform/` folder. MAIN holds the user's real projects and stays
banner-free. Next work happens on `dev`.
