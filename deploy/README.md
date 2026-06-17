# Deploying to the jarvis server

The server (`dan@100.102.159.57`, `/opt/jarvis-dashboard`) is a **git checkout of
`main`**, authenticated with a read-only SSH deploy key (`~/.ssh/jarvis-dashboard-deploy`,
used via the `github-jarvis-dashboard` host alias in `~/.ssh/config`). `.env`,
`data/`, `node_modules/`, and `.next/` are gitignored and live only on the server.

## Updating (the normal case)

Push to `main`, then run the deploy script:

```bash
ssh dan@100.102.159.57 /opt/jarvis-dashboard/deploy/update.sh
```

It does `git pull --ff-only && npm ci && npm run build && systemctl restart jarvis-dashboard`.

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
