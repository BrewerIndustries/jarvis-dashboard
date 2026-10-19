# Jarvis Dashboard

A personal project dashboard styled like a DOS TUI (Norton Commander / Turbo Pascal) —
a live card grid of every Jarvis project, auto-populated and grouped by lifecycle lane.

**How ideas, backlog, and projects flow across the constellation:** see [WORKFLOW.md](WORKFLOW.md)
(Idea Log → Dashboard → `BACKLOG.md`; Baseliner is an optional formal layer, not the default).

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
| health      | `/api/health` ping (any HTTP response = online; one retry, cached DNS) |

## Health tab

A second view (header toggle) shows server health. `/api/system-health` gathers
**host metrics locally** — the dashboard runs on the jarvis server, so it reports
straight from `os`/`/proc`/shell:

- **Memory** — RAM usage (`/proc/meminfo` `MemAvailable`, matching `free -h`).
- **Updates** — pending apt updates, security count, and reboot-required
  (`apt-check` + `/var/run/reboot-required`). Colors escalate green→amber→red.
- **Host / Hardware** — CPU, cores, iGPU (via `lspci`), arch.
- **Platform** — the full software stack, grouped Runtimes / Containers / Web-TLS
  / Network / System: OS, kernel, Node, npm, Python, pip, Docker, nginx, certbot,
  OpenSSL, Tailscale, ufw, git, systemd, bash. Each carries an **outdated flag**
  from `apt list --upgradable` (local, no network) — an amber `▲ <version>` tag
  when a newer package is available. The shell call widens `PATH` so sbin tools
  resolve; results are cached with a 15-min TTL (apt state changes ~daily), so the
  30s UI poll never reruns apt.

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

## Custom sections

Each lane can be subdivided into your own named **sections** (e.g. a "Games" group
inside Live). Sections are created and managed from the UI:

- **+ Section** on a lane header adds a section to that lane; click a section's name
  (or the ✎) to rename, ✕ to delete (its cards fall back to *Ungrouped*).
- Move a card into a section by **dragging** it onto the section, or via the card's
  **⋯ → Move to…** menu (which also offers *New section* and *Remove from section*).

Sections live in the same layout-prefs overlay as manual card order and collapsed
lanes (`sectionOf` maps card id → section) — persisted server-side in `data/prefs.json`
via `/api/prefs`, so they follow you across devices and **survive the cron registry
sync**. A card always keeps its registry-driven lane; a section only sub-groups within
that lane. Sections show only in **Manual** sort with no active filter (other sorts
reorder globally, and filtering flattens the view). *Reset layout* clears them.

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
