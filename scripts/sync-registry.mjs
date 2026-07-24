#!/usr/bin/env node
// Build the unified project registry that the dashboard + launcher read.
//
// Per-repo `.jarvis.json` is the source of record for the card's declared fields —
// `id`, `name`, `description`, `category`, `status` (per-env lane), `deploy`. The rest
// is auto-derived from the repo via the GitHub API (and a few fields fall back to
// README/package.json only until a repo has tidied its own declaration):
//   • name/description — .jarvis.json (→ README H1 / package.json as fallback)
//   • version     — latest git release/tag
//   • lastCommit  — latest commit date on the synced branch
//   • backlog     — open checkboxes in BACKLOG.md, else items under a README ## Backlog/## TODO
//   • repoUrl / liveUrl — GitHub link + the public launch URL (deployed apps only)
//
// Env: GITHUB_TOKEN (required for private repos) · JARVIS_REF (dev|main) · OUT (comma-sep paths)

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const ORG = "BrewerIndustries";
const DOMAIN = process.env.JARVIS_DOMAIN ?? "dabrewer.dev";
const REPOS = [
  "Jarvis",
  "jarvis-dashboard",
  "jarvis-launcher",
  "jarvis-timer",
  "jarvis-jams",
  "idea-log",
  "bpt-2.0",
  "spacebaserace",
  "Stellar-Ascent",
  "poker",
  "jarvis-junction",
  "tessera",
  "tessera-court-mock",
  "tessera-dems-mock",
  "historic-map",
  "dans-recipes",
  "blobby",
  "taco-loco",
  "brookeslist",
  "jarvis-cam",
  "baselining-tool",
];

// Fallback for the declared fields only (id/category/status/deploy) when a repo has
// no .jarvis.json yet. `subdomain` overrides the public-URL slug where it differs from id.
const DEFAULTS = {
  "jarvis-dashboard": { id: "dashboard", category: "jarvis-tools", status: { prod: "live", dev: "live" }, deploy: { prod: { port: 4500 }, dev: { port: 4510 } } },
  "jarvis-launcher": { id: "launcher", category: "jarvis-tools", status: { prod: "live", dev: "live" }, deploy: { prod: { port: 4400 }, dev: { port: 4410 } } },
  "jarvis-timer": { id: "jarvis-timer", category: "standalone", status: { prod: "live", dev: "live" }, deploy: { prod: { url: "https://jarvis-timer.dabrewer.dev/" }, dev: { url: "https://jarvis-timer.dabrewer.dev/dev/" } } },
  "jarvis-jams": { id: "jarvis-jams", category: "standalone", status: { prod: "live", dev: "live" }, deploy: { prod: { url: "https://jarvis-jams.dabrewer.dev/" }, dev: { url: "https://jarvis-jams.dabrewer.dev/dev/" } } },
  "dans-recipes": { id: "dans-recipes", category: "standalone", status: { prod: "live", dev: "live" }, deploy: { prod: { url: "https://dans-recipes.dabrewer.dev/" }, dev: { url: "https://dans-recipes.dabrewer.dev/dev/" } } },
  "idea-log": { id: "idea-log", category: "standalone", status: { prod: "live", dev: "live" }, deploy: { prod: { port: 4660 }, dev: { port: 4670 } } },
  Jarvis: { id: "voice", subdomain: "jarvis", category: "jarvis-tools", status: { prod: "live", dev: "live" }, deploy: { prod: { port: 8080, https: true }, dev: { port: 8090, https: true } } },
  spacebaserace: { id: "spacebaserace", category: "games", status: { prod: "live", dev: "live" }, deploy: { prod: { url: "https://spacebaserace.dabrewer.dev/" }, dev: { url: "https://spacebaserace.dabrewer.dev/dev/" } } },
  "Stellar-Ascent": { id: "stellar-ascent", category: "games", status: { prod: "live", dev: "live" }, deploy: { prod: { url: "https://stellar-ascent.dabrewer.dev/" }, dev: { url: "https://stellar-ascent.dabrewer.dev/dev/" } } },
  poker: { id: "poker", category: "games", status: { prod: "live", dev: "live" }, deploy: { prod: { url: "https://poker.dabrewer.dev/" }, dev: { url: "https://poker.dabrewer.dev/dev/" } } },
  "jarvis-junction": { id: "jarvis-junction", category: "games", status: { prod: "in_progress", dev: "live" }, deploy: { prod: { url: "https://jarvis-junction.dabrewer.dev/" }, dev: { url: "https://jarvis-junction.dabrewer.dev/dev/" } } },
  "bpt-2.0": { id: "bpt-2", category: "apps", status: "mothballed" },
  tessera: { id: "tessera", category: "apps", status: { prod: "in_progress", dev: "in_progress" } },
  "tessera-court-mock": { id: "court-mock", category: "apps", status: { prod: "in_progress", dev: "in_progress" } },
  "tessera-dems-mock": { id: "dems-mock", category: "apps", status: { prod: "in_progress", dev: "in_progress" } },
  "historic-map": { id: "historic-map", category: "standalone", status: { prod: "live", dev: "live" }, deploy: { prod: { url: "https://historic-map.dabrewer.dev/" }, dev: { url: "https://historic-map.dabrewer.dev/dev/" } } },
  "blobby": { id: "blobby", category: "games", status: { prod: "in_progress", dev: "live" }, deploy: { prod: { url: "https://blobby.dabrewer.dev/" }, dev: { url: "https://blobby.dabrewer.dev/dev/" } } },
  "taco-loco": { id: "taco-loco", category: "games", status: { prod: "in_progress", dev: "live" }, deploy: { prod: { url: "https://tacoloco.dabrewer.dev/" }, dev: { url: "https://tacoloco.dabrewer.dev/dev/" } } },
  "brookeslist": { id: "brookeslist", category: "standalone", status: { prod: "in_progress", dev: "in_progress" }, deploy: { prod: { url: "https://brookeslist.dabrewer.dev/" }, dev: { url: "https://brookeslist.dabrewer.dev/dev/" } } },
  "jarvis-cam": { id: "cam", category: "jarvis-tools", status: { prod: "live", dev: "live" }, deploy: { prod: { port: 4680 }, dev: { port: 4690 } } },
};

const TOKEN = process.env.GITHUB_TOKEN;
const REF = process.env.JARVIS_REF || "main";
const ENV = REF === "dev" ? "dev" : "prod";
const OUT = (process.env.OUT || "./data/registry.json").split(",").map((s) => s.trim()).filter(Boolean);

const HEADERS = {
  "user-agent": "jarvis-registry-sync",
  ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}),
};

// Raw file contents at a ref, or undefined on 404.
async function raw(repo, ref, path) {
  const res = await fetch(
    `https://api.github.com/repos/${ORG}/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`,
    { headers: { ...HEADERS, accept: "application/vnd.github.raw+json" } },
  );
  if (res.status === 404) return undefined;
  if (!res.ok) throw new Error(`GitHub ${res.status} ${repo}/${path}`);
  return res.text();
}

// Read a file at REF, falling back to main (e.g. main-only repos with no dev branch).
async function readFile(repo, path) {
  let t = await raw(repo, REF, path).catch(() => undefined);
  if (t === undefined && REF !== "main") t = await raw(repo, "main", path).catch(() => undefined);
  return t;
}

async function lastCommitDate(repo) {
  for (const ref of REF === "main" ? ["main"] : [REF, "main"]) {
    const res = await fetch(
      `https://api.github.com/repos/${ORG}/${repo}/commits/${encodeURIComponent(ref)}`,
      { headers: { ...HEADERS, accept: "application/vnd.github+json" } },
    ).catch(() => null);
    if (res && res.ok) {
      const c = await res.json();
      return c?.commit?.committer?.date ?? c?.commit?.author?.date ?? null;
    }
  }
  return null;
}

// Version from git: latest GitHub release, else the most recent tag, else null.
async function gitVersion(repo) {
  const api = { ...HEADERS, accept: "application/vnd.github+json" };
  const rel = await fetch(`https://api.github.com/repos/${ORG}/${repo}/releases/latest`, { headers: api }).catch(() => null);
  if (rel && rel.ok) {
    const r = await rel.json();
    if (r?.tag_name) return r.tag_name;
  }
  const tags = await fetch(`https://api.github.com/repos/${ORG}/${repo}/tags?per_page=1`, { headers: api }).catch(() => null);
  if (tags && tags.ok) {
    const t = await tags.json();
    if (Array.isArray(t) && t[0]?.name) return t[0].name;
  }
  return null;
}

function clean(s) {
  return s ? s.replace(/[*_`]/g, "").replace(/\s+/g, " ").trim() : s;
}

// README H1 → title; first real paragraph after it → description.
function parseReadme(md) {
  if (!md) return {};
  const h1 = md.match(/^\s*#\s+(.+?)\s*$/m);
  let description;
  if (h1) {
    const para = md
      .slice(md.indexOf(h1[0]) + h1[0].length)
      .split(/\n\s*\n/)
      .map((s) => s.trim())
      .find((s) => s && !/^[#>!|]|^```|^---/.test(s));
    description = clean(para);
  }
  return { title: clean(h1?.[1]), description };
}

// Open checkboxes in BACKLOG.md (→ all list items if none), else items under a
// README ## Backlog / ## TODO section.
function backlogCount(backlog, readme) {
  if (backlog != null) {
    const open = (backlog.match(/^\s*[-*]\s+\[ \]/gm) || []).length;
    return open || (backlog.match(/^\s*[-*]\s+/gm) || []).length;
  }
  if (readme != null) {
    let inSec = false;
    let n = 0;
    for (const line of readme.split("\n")) {
      const h = line.match(/^#{1,6}\s+(.+)/);
      if (h) {
        inSec = /backlog|to.?do/i.test(h[1]);
        continue;
      }
      if (inSec && /^\s*[-*]\s+/.test(line)) n++;
    }
    return n;
  }
  return 0;
}

function liveUrl(m) {
  const t = m.deploy?.[ENV];
  if (!t) return null; // not deployed in this env → nothing to launch
  if (t.url) return t.url;
  const sub = m.subdomain ?? m.id;
  return ENV === "dev" ? `https://${sub}.dev.${DOMAIN}` : `https://${sub}.${DOMAIN}`;
}

function normalizeStatus(s) {
  if (typeof s === "string") return { prod: s, dev: s };
  const prod = s?.prod ?? "in_progress";
  return { prod, dev: s?.dev ?? prod };
}

async function fetchDecl(repo) {
  const t = await readFile(repo, ".jarvis.json");
  return t ? JSON.parse(t) : null;
}

async function main() {
  const out = [];
  for (const repo of REPOS) {
    let decl = null;
    try {
      decl = await fetchDecl(repo);
    } catch (e) {
      console.error(`! ${repo}: ${e.message}`);
    }
    const m = { ...(DEFAULTS[repo] || {}), ...(decl || {}) };
    if (!m.id) {
      console.error(`! ${repo}: no id and no default — skipping`);
      continue;
    }
    m.status = normalizeStatus(m.status);

    const [pkgText, readmeText, backlogText, lastCommit, version] = await Promise.all([
      readFile(repo, "package.json"),
      readFile(repo, "README.md"),
      readFile(repo, "BACKLOG.md"),
      lastCommitDate(repo),
      gitVersion(repo),
    ]);
    let pkg = {};
    try {
      pkg = pkgText ? JSON.parse(pkgText) : {};
    } catch {
      /* malformed package.json — ignore */
    }
    const rm = parseReadme(readmeText);

    // .jarvis.json is the source of record for name/description; README + package.json
    // are only fallbacks until a repo has tidied its own declaration.
    const card = {
      id: m.id,
      name: m.name || rm.title || repo,
      description: m.description || pkg.description || rm.description || "",
      version,
      category: m.category || "apps",
      status: m.status,
      lastCommit,
      backlog: backlogCount(backlogText, readmeText),
      repo: `${ORG}/${repo}`,
      repoUrl: `https://github.com/${ORG}/${repo}`,
      liveUrl: liveUrl(m),
      deploy: m.deploy ?? null,
    };
    out.push(card);
    const date = lastCommit ? new Date(lastCommit).toISOString().slice(0, 10) : "????-??-??";
    console.log(`${decl ? "✓" : "·"} ${repo.padEnd(20)} ${card.name} · v${card.version ?? "?"} · ${card.status[ENV]} · backlog ${card.backlog} · ${date}`);
  }
  for (const path of OUT) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(out, null, 2) + "\n");
    console.log(`wrote ${out.length} cards -> ${path}  (ref=${REF})`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
