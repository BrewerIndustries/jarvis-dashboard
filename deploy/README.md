# Deploying to the jarvis server

Two environments live on the jarvis server (`dan@100.102.159.57`), each a **git
checkout** authenticated with the read-only deploy key (`~/.ssh/jarvis-dashboard-deploy`,
via the `github-jarvis-dashboard` host alias in `~/.ssh/config`):

| Env  | Branch | Path                       | Port | Service                  |
| ---- | ------ | -------------------------- | ---- | ------------------------ |
| MAIN | `main` | `/opt/jarvis-dashboard`     | 4500 | `jarvis-dashboard`       |
| DEV  | `dev`  | `/opt/jarvis-dashboard-dev` | 4510 | `jarvis-dashboard-dev`   |

Each has its own `.env` (separate `JARVIS_TOKEN`) and isolated SQLite DB.
`.env`, `data/`, `node_modules/`, and `.next/` are gitignored and live only on
the server.

**Environment banner:** DEV's `.env` must include `JARVIS_ENV=dev` so the UI shows
its amber "DEV ENVIRONMENT — NOT PRODUCTION" strip and `[DEV]` tab title. **MAIN must
leave `JARVIS_ENV` unset** (or `main`) so production shows no banner. The value is read
at request time, so editing `.env` + `systemctl restart <service>` is enough — no rebuild
needed for the banner alone.

## Workflow

Work on `dev`, deploy to DEV, and **promote to MAIN only on explicit say-so**:

```bash
# develop locally on the dev branch, then:
git push origin dev
ssh dan@100.102.159.57 /opt/jarvis-dashboard-dev/deploy/update-dev.sh   # → DEV (:4510)

# once approved, promote dev → main and deploy prod:
git checkout main && git merge --ff-only dev && git push origin main
ssh dan@100.102.159.57 /opt/jarvis-dashboard/deploy/update.sh           # → MAIN (:4500)
```

Each `update*.sh` does `git pull --ff-only && npm ci && npm run build && systemctl restart <service>`.

---

## First-time / from-scratch setup (already done once)

These steps assume an SSH-accessible Linux server with Node 20+ installed.

### 1. Copy the project (without node_modules)

```bash
rsync -av --exclude node_modules --exclude .next --exclude data \
  ./ jarvis:/opt/jarvis-dashboard/
```

## 2. Build on the server

```bash
ssh jarvis
cd /opt/jarvis-dashboard
cp .env.example .env        # set a strong JARVIS_TOKEN (openssl rand -hex 24)
npm ci
npm run build
```

`better-sqlite3` compiles a native binary, so build on the server (don't copy
`node_modules` from macOS).

## 3. Run it as a service

```bash
sudo cp deploy/jarvis-dashboard.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now jarvis-dashboard
sudo systemctl status jarvis-dashboard
```

It listens on `:4500`. Put it behind your existing reverse proxy (nginx/Caddy)
with TLS, or expose the port directly on a trusted network.

### Caddy example

```
jarvis.example.com {
    reverse_proxy localhost:4500
}
```

## 4. Point your sessions at it

On each machine you use Claude Code from:

```bash
export JARVIS_URL="https://jarvis.example.com"
export JARVIS_TOKEN="<the same token>"
```

The SQLite DB lives at `/opt/jarvis-dashboard/data/jarvis.db` — back that file
up if the items matter.
