# 🛰️ Shipping a new Jarvis sub-project — recipe card

How to get a new app onto the Jarvis server with **dev + prod sites on their own
URLs**, hooked into the **dashboard** (the single front door). This mirrors how
the dashboard, voice assistant, the games, and Tessera were shipped.

> The **launcher** was retired — its front-door + health-check role folded into
> the dashboard. This playbook used to live in `jarvis-launcher/NEW-PROJECT.md`;
> it now lives here.

## The model (read once)

- One GitHub repo per project (org **`BrewerIndustries`**) with a **`dev`** and a
  **`main`** branch.
- **`dev` branch → DEV site · `main` branch → PROD site.** Two fully separate
  deployments — dev work can never take down prod.
- URLs: **`<app>.dabrewer.dev`** (prod) and **`<app>.dev.dabrewer.dev`** (dev).
  The box is `dan@100.102.159.57` (Tailscale).
- **TLS**: wildcard Let's Encrypt — `*.dabrewer.dev` + `*.dev.dabrewer.dev`
  (certbot + Cloudflare DNS-01). New subdomains are already covered.
- **DNS** (Cloudflare): **dev** subdomains resolve via a `*.dev.dabrewer.dev`
  wildcard — nothing to add. **prod** subdomains need an explicit record (API
  token at `/etc/cloudflare/credentials.ini`).

## 1. Declare it — `.jarvis.json` (the dashboard hookup)

Drop a `.jarvis.json` at the repo root:

```json
{
  "id": "myapp",
  "name": "My App",
  "category": "standalone",
  "status": { "prod": "in_progress", "dev": "live" },
  "deploy": { "prod": { "port": 4660, "https": false },
              "dev":  { "port": 4670, "https": false } }
}
```

`status` lanes are `live` | `in_progress` | `mothballed`. A cron
(`/opt/jarvis-dashboard*/deploy/sync-registry.sh`, every 15 min) reads every
repo's `.jarvis.json` via the GitHub API — **dev branch → dev registry, main →
prod registry** — and writes `registry.json` into the dashboard. That's
how the app appears with its lane tag. (Private repos need `GITHUB_TOKEN` in
`~/.config/jarvis/registry-sync.env`.)

## 2. Pick a hosting flavor

### A) Static site (plain HTML / SPA, no server) → **GitHub Pages**

- Add `.github/workflows/pages.yml` **on the `dev` branch** that publishes
  `main` → `/` and `dev` → `/dev/`, writing a `CNAME` of `<app>.dabrewer.dev`.
- Set Pages source = "GitHub Actions"; in the repo's **`github-pages`
  environment**, allow the `dev` branch to deploy (default policy blocks non-default branches).
- DNS: CNAME `<app>.dabrewer.dev` → `brewerindustries.github.io` (DNS-only). Dev
  lives at `<app>.dabrewer.dev/dev/`.
- Examples: Stellar Ascent, Space Base Race, Jarvis Poker.

### B) App with a server (Next.js `next start`, API routes, a DB) → **systemd + nginx**

1. **dev branch**: `gh api repos/BrewerIndustries/<repo>/git/refs -f ref=refs/heads/dev -f sha=<main-sha>`
2. **Deploy key** (private repos): on the box `ssh-keygen -t ed25519 -f ~/.ssh/<repo>-deploy`,
   add the pubkey as a **read-only** deploy key (`gh repo deploy-key add`), and an
   SSH alias `Host github-<repo>` → that key in `~/.ssh/config`.
3. **Clone**: `/opt/<repo>` ← `main`, `/opt/<repo>-dev` ← `dev`.
4. **DB if needed**: Postgres on the host — `createdb <app>_dev` + `<app>_prod`,
   `DATABASE_URL` in each clone's `.env`.
5. **Build + run**: `npm install && npm run build`; one systemd unit per env
   running `node_modules/.bin/next start -p <port>`. Commit the units **and a
   `deploy/update.sh` / `update-dev.sh`** to `deploy/` — start each with
   `git checkout -- package-lock.json 2>/dev/null || true` before the pull (see Gotchas).
6. **nginx**: a `server{}` block per subdomain proxying to `localhost:<port>`
   (dev block uses the `*.dev.dabrewer.dev` cert, prod the `*.dabrewer.dev` cert);
   `sudo nginx -t && sudo systemctl reload nginx`.
7. **prod DNS**: add an A record `<app>.dabrewer.dev` → `100.102.159.57` via the
   Cloudflare API (DNS-only). Dev resolves via the wildcard.
- Examples: dashboard, voice, Tessera + the two mocks.

## 3. That's it — the dashboard auto-discovers it

**No dashboard edit is needed.** The cron (`scripts/sync-registry.mjs`) enumerates
every repo on the `BrewerIndustries` account and includes any that has a committed
`.jarvis.json` — so **step 1 is the whole registration**. The card's fields all come
from that file (name, description, category, per-env lane, deploy target); version /
last-commit / backlog are auto-derived from the repo. The dashboard renders the card
on its own — no separate front-door step. Pick `category` from the ids it groups by
(`jarvis-tools` / `standalone` / `games` / `tessera`).

The cron runs every 15 min. To see the card immediately instead of waiting, trigger
a sync on the box:

```bash
ssh dan@100.102.159.57 /opt/jarvis-dashboard-dev/deploy/sync-registry.sh   # dev registry
ssh dan@100.102.159.57 /opt/jarvis-dashboard/deploy/sync-registry.sh       # prod registry
```

To **remove** a project from the dashboard, delete its `.jarvis.json` (or archive
the repo). If a repo's `.jarvis.json` is incomplete, add a fallback entry to the
`DEFAULTS` map in `sync-registry.mjs` — optional, and prunable once the repo declares
its own fields.

## 4. Promote (the CI/CD path)

- Work on **`dev`** → deploy to the dev site → verify there.
- Promote to prod **only via a PR you approve** — never fast-forward / reset-push.
  Merge the PR, then redeploy the prod clone from `main` (server apps) or push
  `main` (Pages rebuilds).

## Ports (server apps)

| project | prod | dev |
|---|---|---|
| dashboard | 4500 | 4510 |
| voice assistant | 8080 | 8090 |
| tessera | 4600 | 4610 |
| court-mock | 4620 | 4630 |
| dems-mock | 4640 | 4650 |

New server app → next free `46x0` (prod) / `+10` (dev) pair.

## Update a deployed app

```bash
# server app — discard the Linux-regenerated lockfile first so the ff pull can't abort
git -C /opt/<repo>[-dev] checkout -- package-lock.json 2>/dev/null || true
git -C /opt/<repo>[-dev] pull && npm install && npm run build && sudo systemctl restart <svc>
# Pages game — just push to the branch; the Action rebuilds
```

Each server repo's `deploy/update*.sh` should bake that `git checkout -- package-lock.json`
in **before** the `git pull` (see the lockfile-drift gotcha) so redeploys self-heal and you
never touch this by hand.

## Gotchas (learned the hard way)

- **Build as `dan`, never `sudo`.** A root-owned `.next/` makes later builds fail
  with `EACCES` (and silently serve the stale build). Recover with `sudo rm -rf .next`.
- **Lockfile drift on Linux.** The box's `npm install` regenerates `package-lock.json`
  differently from the committed macOS one. Two symptoms, one cause: (a) `npm ci` fails on
  the `@emnapi/*` mismatch → **use `npm install`**; (b) the now-dirty lockfile makes the next
  `git pull --ff-only` **abort** (`Please commit your changes… Aborting`). Fix both by baking
  **`git checkout -- package-lock.json 2>/dev/null || true`** into each repo's
  `deploy/update*.sh` right **before** the pull, so redeploys self-heal. (First surfaced on
  `savings-tracker`, the first heavily-iterated `better-sqlite3` server app — static Pages
  apps never hit it since the box never runs their `npm install`.)
- **Prisma** pinned to a major → call **`./node_modules/.bin/prisma`**; bare
  `npx prisma` grabs the latest major, which can reject an older schema
  (e.g. v7 dropped `url = env()`).
- **Pages** — the repo's `github-pages` environment restricts deploys to the
  default branch by default; add a deployment-branch-policy for `dev`.
- **`main` is gated** — every prod promotion is a PR the owner approves.

---

_Server/deploy details also live in each repo's `deploy/README.md`._
