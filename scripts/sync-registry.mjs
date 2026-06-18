#!/usr/bin/env node
// Aggregate every Jarvis project's committed `.jarvis.json` into one registry that
// both the dashboard and the launcher read. The per-repo .jarvis.json is the source
// of truth for a project's lifecycle status + deploy info; this script (run on the
// server via cron) fetches them through the GitHub API and writes the merged file.
//
// Repos without a .jarvis.json fall back to the DEFAULTS below, so the registry is
// always complete and the system works before every repo has declared itself.
//
// Env:
//   GITHUB_TOKEN  — token with read access to the BrewerIndustries repos (required on the server)
//   JARVIS_REF    — branch to read .jarvis.json from (default "main"; pass "dev" for the dev registry)
//   OUT           — comma-separated output paths (default "./data/registry.json")

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const ORG = "BrewerIndustries";
const REPOS = [
  "Jarvis",
  "jarvis-dashboard",
  "jarvis-launcher",
  "bpt-2.0",
  "spacebaserace",
  "Stellar-Ascent",
  "tessera",
  "tessera-court-mock",
  "tessera-dems-mock",
];

// Fallback declarations for repos that haven't committed a .jarvis.json yet.
// (Verified against live probes of all dev+prod endpoints.)
const DEFAULTS = {
  "jarvis-dashboard": { id: "dashboard", name: "Jarvis Dashboard", category: "jarvis-tools", status: { prod: "live", dev: "live" }, deploy: { prod: { port: 4500 }, dev: { port: 4510 } } },
  "jarvis-launcher": { id: "launcher", name: "Jarvis Launcher", category: "jarvis-tools", status: { prod: "live", dev: "live" }, deploy: { prod: { port: 4400 }, dev: { port: 4410 } } },
  Jarvis: { id: "voice", name: "Jarvis", category: "jarvis-tools", status: { prod: "live", dev: "live" }, deploy: { prod: { port: 8080, https: true }, dev: { port: 8090, https: true } } },
  spacebaserace: { id: "spacebaserace", name: "Space Base Race", category: "games", status: { prod: "live", dev: "live" }, deploy: { prod: { url: "https://spacebaserace.dabrewer.dev/" }, dev: { url: "https://spacebaserace.dabrewer.dev/dev/" } } },
  "Stellar-Ascent": { id: "stellar-ascent", name: "Stellar Ascent", category: "games", status: { prod: "live", dev: "live" }, deploy: { prod: { url: "https://stellar-ascent.dabrewer.dev/" }, dev: { url: "https://stellar-ascent.dabrewer.dev/dev/" } } },
  "bpt-2.0": { id: "bpt-2", name: "BPT 2.0", category: "apps", status: "mothballed" },
  tessera: { id: "tessera", name: "Tessera", category: "apps", status: { prod: "in_progress", dev: "in_progress" } },
  "tessera-court-mock": { id: "court-mock", name: "Court Mock", category: "apps", status: { prod: "in_progress", dev: "in_progress" } },
  "tessera-dems-mock": { id: "dems-mock", name: "DEMS Mock", category: "apps", status: { prod: "in_progress", dev: "in_progress" } },
};

const TOKEN = process.env.GITHUB_TOKEN;
const REF = process.env.JARVIS_REF || "main";
const OUT = (process.env.OUT || "./data/registry.json").split(",").map((s) => s.trim()).filter(Boolean);

async function fetchAt(repo, ref) {
  const url = `https://api.github.com/repos/${ORG}/${repo}/contents/.jarvis.json?ref=${encodeURIComponent(ref)}`;
  const res = await fetch(url, {
    headers: {
      accept: "application/vnd.github.raw+json",
      "user-agent": "jarvis-registry-sync",
      ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}),
    },
  });
  if (res.status === 404) return undefined; // no file on this ref
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  return JSON.parse(await res.text());
}

async function fetchDecl(repo) {
  // Read from the requested ref; if absent (e.g. a main-only repo has no `dev`
  // branch), fall back to main so its declaration is still picked up.
  let decl = await fetchAt(repo, REF);
  if (decl === undefined && REF !== "main") decl = await fetchAt(repo, "main");
  return decl ?? null;
}

function normalizeStatus(s) {
  if (typeof s === "string") return { prod: s, dev: s };
  const prod = s?.prod ?? "in_progress";
  return { prod, dev: s?.dev ?? prod };
}

async function main() {
  const out = [];
  for (const repo of REPOS) {
    let decl = null;
    try {
      decl = await fetchDecl(repo);
    } catch (e) {
      console.error(`! ${repo}: ${e.message} — using default`);
    }
    const merged = { ...(DEFAULTS[repo] || {}), ...(decl || {}) };
    if (!merged.name) {
      console.error(`! ${repo}: no declaration and no default — skipping`);
      continue;
    }
    merged.repo = `${ORG}/${repo}`;
    merged.status = normalizeStatus(merged.status);
    out.push(merged);
    console.log(`${decl ? "✓ declared" : "· default "}  ${repo} -> ${merged.name} [${merged.status.prod}/${merged.status.dev}]`);
  }
  for (const path of OUT) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(out, null, 2) + "\n");
    console.log(`wrote ${out.length} entries -> ${path}  (ref=${REF})`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
