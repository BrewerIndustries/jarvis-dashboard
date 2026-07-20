# Jarvis Dashboard

A personal project dashboard styled like a DOS TUI (Norton Commander / Turbo Pascal) —
a live card grid of every Jarvis project, auto-populated and grouped by lifecycle lane.

## How it works

Each project has a `.jarvis.json` at its repo root declaring its id, name, description,
lifecycle status, and deploy info. A cron job runs `scripts/sync-registry.mjs` every
15 minutes; it pulls the declaration from each repo via the GitHub API, enriches it with
git version, last-commit date, and backlog count, and writes `data/registry.json`. The
dashboard reads that file, groups cards by lane, and shows a health badge for every
deployed instance.

```
.jarvis.json (per repo)
    ↓  GitHub API  (sync-registry.mjs, cron every 15 min)
data/registry.json
    ↓
/api/registry  →  cards for this env
/api/health    →  ● LIVE / ○ DOWN per deployment
    ↓
Dashboard — card grid: LIVE / IN PROGRESS / MOTHBALLED
```

## Card fields

| field       | source                                                    |
| ----------- | --------------------------------------------------------- |
| name        | `.jarvis.json` → README H1 → repo name                    |
| description | `.jarvis.json` → package.json description → README        |
| version     | latest GitHub release tag → most recent git tag           |
| last commit | latest commit on the synced branch                        |
| backlog     | open `- [ ]` items in BACKLOG.md → README ## Backlog/TODO |
| live URL    | `deploy[env].url` or derived from subdomain convention    |
| health      | `/api/health` ping (any HTTP response = online)           |

## Health tab

A second view (header toggle) shows server health. `/api/system-health` gathers
**host metrics locally** — the dashboard runs on the jarvis server, so it reports
straight from `os`/`/proc`/shell:

- **Memory** — RAM usage (`/proc/meminfo` `MemAvailable`, matching `free -h`).
- **Host / Hardware** — CPU, cores, iGPU (via `lspci`), arch.
- **Platform** — runtime/stack versions: OS, Node (`process.version`), Docker,
  nginx, Python, Tailscale. Detected once and cached (they change only on
  upgrade/redeploy); the shell call widens `PATH` so sbin tools resolve.

It also proxies the Jarvis core (`JARVIS_URL`) for disk, services, **containers**,
and the health log. If the Jarvis core is unreachable, the locally-gathered cards
(Memory, Hardware, Platform) still render; the core-dependent cards degrade to an
"offline" state.

## `.jarvis.json` shape

```json
{
  "id": "my-project",
  "name": "My Project",
  "description": "One-line description shown on the card.",
  "category": "jarvis-tools",
  "status": { "prod": "live", "dev": "live" },
  "deploy": {
    "prod": { "port": 4500 },
    "dev":  { "port": 4510 }
  }
}
```

Lanes: `live` · `in_progress` · `mothballed`. The DEV board reads `status.dev`;
the prod board reads `status.prod`.

## Run locally

```bash
npm install
# write a local data/registry.json (normally produced by the cron):
GITHUB_TOKEN=<pat> JARVIS_REF=dev node scripts/sync-registry.mjs
npm run dev    # http://localhost:3000
```

## Deploy

See `deploy/` for systemd units and update scripts. In short:
```bash
npm ci && npm run build && npm start   # port 4500 (prod) or 4510 (dev)
```

## Stack

Next.js 16 · React 19 · Tailwind 4 · no database · no auth
