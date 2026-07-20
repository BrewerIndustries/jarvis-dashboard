import { NextResponse } from "next/server";
import https from "node:https";
import os from "node:os";
import { readFileSync } from "node:fs";
import { exec } from "node:child_process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const JARVIS_URL = process.env.JARVIS_URL ?? "https://localhost:8080";

// Jarvis uses a self-signed cert — skip verification for this localhost-only proxy.
function httpsGet(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), 4000);
    https.get(url, { rejectUnauthorized: false }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        clearTimeout(timer);
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch (e) { reject(e); }
      });
    }).on("error", (e) => { clearTimeout(timer); reject(e); });
  });
}

// --- host hardware / memory --------------------------------------------------
// The dashboard runs on the jarvis server itself, so `os` reflects that host.

const GB = 1024 ** 3;
const gb1 = (n: number) => Math.round((n / GB) * 10) / 10;

function memInfo() {
  let total = os.totalmem();
  let free = os.freemem(); // fallback for non-Linux (Mac dev)
  try {
    // Prefer /proc/meminfo MemAvailable: os.freemem() excludes reclaimable
    // cache and badly overstates usage. MemAvailable matches `free -h` "available".
    const raw = readFileSync("/proc/meminfo", "utf8");
    const kb = (key: string) => {
      const m = raw.match(new RegExp(`^${key}:\\s+(\\d+)\\s+kB`, "m"));
      return m ? parseInt(m[1], 10) * 1024 : null;
    };
    const t = kb("MemTotal");
    const avail = kb("MemAvailable");
    if (t) total = t;
    if (avail != null) free = avail;
  } catch { /* non-Linux or unreadable — use os.freemem() */ }
  const used = Math.max(total - free, 0);
  const pct = total ? Math.round((used / total) * 100) : 0;
  return { pct, used_gb: gb1(used), total_gb: gb1(total), ok: pct < 90 };
}

function cleanCpu(model: string) {
  return model.replace(/\((R|TM)\)/g, "").replace(/\s+/g, " ").trim();
}

// GPU is static hardware — detect once via lspci and cache for the process lifetime.
let gpuCache: string | null | undefined;
function detectGpu(): Promise<string | null> {
  if (gpuCache !== undefined) return Promise.resolve(gpuCache);
  return new Promise((resolve) => {
    exec(
      "lspci 2>/dev/null | grep -iE 'vga|3d controller|display' | head -1",
      { timeout: 2500 },
      (err, stdout) => {
        let gpu: string | null = null;
        const line = (stdout || "").trim();
        if (!err && line) {
          // e.g. "00:02.0 VGA compatible controller: Intel Corporation HD Graphics 530 (rev 06)"
          const after = line.split(": ").slice(1).join(": ").trim();
          gpu = (after || line)
            .replace(/\s*\(rev[^)]*\)\s*$/i, "")
            .replace(/\bCorporation\b/i, "")
            .replace(/\s+/g, " ")
            .trim();
        }
        gpuCache = gpu || process.env.SPECS_GPU || null;
        resolve(gpuCache);
      },
    );
  });
}

// --- platform / software stack -----------------------------------------------
// The software the projects run on (runtimes, web/TLS, network, system). Versions
// + apt "outdated" state change slowly, so detect and cache with a TTL.

interface PlatformItem { name: string; version: string; group: string; outdated: boolean; latest?: string }
interface UpdateInfo { upgradable: number; security: number; reboot: boolean }

// Each entry: display name, its raw key in the version dump, a regex to pull the
// number out, the apt package(s) that signal "outdated", and a UI group.
const SOFTWARE: {
  name: string; key: string; re?: RegExp; pkgs?: string[]; group: string;
}[] = [
  { name: "OS",        key: "os",                                   group: "System" },
  { name: "Kernel",    key: "kernel",  pkgs: ["linux-image-generic", "linux-generic"], group: "System" },
  { name: "Node",      key: "__node",                               group: "Runtimes" },
  { name: "npm",       key: "npm",                     pkgs: ["npm"],        group: "Runtimes" },
  { name: "Python",    key: "python",  re: /([0-9]+\.[0-9]+\.[0-9]+)/, pkgs: ["python3"], group: "Runtimes" },
  { name: "pip",       key: "pip",     re: /pip ([0-9.]+)/,         pkgs: ["python3-pip"], group: "Runtimes" },
  { name: "Docker",    key: "docker",  re: /version ([0-9][0-9.]+)/, pkgs: ["docker.io", "docker-ce"], group: "Containers" },
  { name: "nginx",     key: "nginx",   re: /nginx\/([0-9.]+)/,      pkgs: ["nginx", "nginx-core", "nginx-common"], group: "Web/TLS" },
  { name: "certbot",   key: "certbot", re: /([0-9]+\.[0-9]+\.[0-9]+)/, pkgs: ["certbot"], group: "Web/TLS" },
  { name: "OpenSSL",   key: "openssl", re: /OpenSSL ([0-9][0-9a-z.]+)/, pkgs: ["openssl"], group: "Web/TLS" },
  { name: "Tailscale", key: "tailscale", re: /([0-9]+\.[0-9]+\.[0-9]+)/, pkgs: ["tailscale"], group: "Network" },
  { name: "ufw",       key: "ufw",     re: /([0-9]+\.[0-9.]+)/,     pkgs: ["ufw"], group: "Network" },
  { name: "git",       key: "git",     re: /version ([0-9][0-9.]+)/, pkgs: ["git"], group: "System" },
  { name: "systemd",   key: "systemd", re: /([0-9]{3})/,            pkgs: ["systemd"], group: "System" },
  { name: "bash",      key: "bash",    re: /version ([0-9][0-9.]+)/, pkgs: ["bash"], group: "System" },
];

// systemd services get a minimal PATH; nginx/tailscale/ufw live in sbin — widen it.
const SOFTWARE_SCRIPT =
  "export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH; " +
  ". /etc/os-release 2>/dev/null; " +
  'echo "@v"; ' +
  'echo "os=$NAME $VERSION_ID"; ' +
  'echo "kernel=$(uname -r)"; ' +
  'echo "npm=$(npm --version 2>/dev/null)"; ' +
  'echo "docker=$(docker --version 2>/dev/null)"; ' +
  'echo "nginx=$(nginx -v 2>&1)"; ' +
  'echo "python=$(python3 --version 2>&1)"; ' +
  'echo "pip=$(pip3 --version 2>/dev/null)"; ' +
  'echo "tailscale=$(tailscale version 2>/dev/null | head -1)"; ' +
  'echo "git=$(git --version 2>/dev/null)"; ' +
  'echo "systemd=$(systemctl --version 2>/dev/null | head -1)"; ' +
  'echo "openssl=$(openssl version 2>/dev/null)"; ' +
  'echo "bash=$(bash --version 2>/dev/null | head -1)"; ' +
  'echo "certbot=$(certbot --version 2>&1 | head -1)"; ' +
  'echo "ufw=$(ufw version 2>/dev/null | head -1)"; ' +
  'echo "aptcheck=$(/usr/lib/update-notifier/apt-check 2>&1)"; ' +
  'echo "reboot=$(test -f /var/run/reboot-required && echo yes || echo no)"; ' +
  'echo "@upg"; ' +
  "apt list --upgradable 2>/dev/null | grep -v '^Listing'";

const stripEpoch = (v: string) => v.replace(/^\d+:/, "");

interface Software { platform: PlatformItem[]; updates: UpdateInfo | null }

let swCache: { at: number; data: Software } | undefined;
const SW_TTL = 15 * 60_000; // apt state changes ~daily; 15 min keeps it fresh & cheap

function detectSoftware(): Promise<Software> {
  if (swCache && Date.now() - swCache.at < SW_TTL) return Promise.resolve(swCache.data);
  return new Promise((resolve) => {
    exec(SOFTWARE_SCRIPT, { timeout: 8000, maxBuffer: 4 << 20 }, (_err, stdout) => {
      const out = stdout || "";
      const vIdx = out.indexOf("@v");
      const uIdx = out.indexOf("@upg");
      const vBlock = uIdx >= 0 ? out.slice(vIdx, uIdx) : out.slice(vIdx);
      const uBlock = uIdx >= 0 ? out.slice(uIdx) : "";

      const raw: Record<string, string> = {};
      for (const line of vBlock.split("\n")) {
        const i = line.indexOf("=");
        if (i > 0) raw[line.slice(0, i).trim()] = line.slice(i + 1).trim();
      }

      // apt candidate versions, keyed by package name
      const upg = new Map<string, string>();
      for (const line of uBlock.split("\n")) {
        const m = line.match(/^([^/\s]+)\/\S+\s+(\S+)/);
        if (m) upg.set(m[1], m[2]);
      }

      const platform: PlatformItem[] = [];
      for (const s of SOFTWARE) {
        const version = s.key === "__node"
          ? process.version.replace(/^v/, "") // the runtime executing this code
          : s.re ? (raw[s.key]?.match(s.re)?.[1] ?? "") : (raw[s.key] ?? "");
        if (!version) continue;
        const hit = s.pkgs?.map((p) => upg.get(p)).find(Boolean);
        platform.push({
          name: s.name,
          version: version.trim(),
          group: s.group,
          outdated: !!hit,
          ...(hit ? { latest: stripEpoch(hit) } : {}),
        });
      }

      // apt-check emits "<updates>;<security>"
      let updates: UpdateInfo | null = null;
      const chk = raw.aptcheck?.match(/^(\d+);(\d+)/);
      if (chk) updates = { upgradable: +chk[1], security: +chk[2], reboot: raw.reboot === "yes" };

      const data: Software = { platform, updates };
      swCache = { at: Date.now(), data };
      resolve(data);
    });
  });
}

async function hostInfo() {
  const cpus = os.cpus();
  const arch = os.arch();
  const [gpu, sw] = await Promise.all([detectGpu(), detectSoftware()]);
  return {
    mem: memInfo(),
    specs: {
      cpu: cpus.length ? cleanCpu(cpus[0].model) : "unknown",
      cores: cpus.length,
      arch: arch === "x64" ? "x86_64" : arch,
      gpu,
    },
    platform: sw.platform,
    updates: sw.updates,
  };
}

export async function GET() {
  const host = await hostInfo();
  try {
    const [status, logs] = await Promise.all([
      httpsGet(`${JARVIS_URL}/api/health`),
      httpsGet(`${JARVIS_URL}/api/health/logs?n=80`),
    ]);
    return NextResponse.json(
      { ok: true, host, status, logs },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    // Jarvis core unreachable — still return locally-gathered host specs + RAM
    // so the health tab stays useful (and can show the server is up but Jarvis isn't).
    return NextResponse.json(
      { ok: true, host, status: null, logs: [], upstreamError: String(err) },
      { headers: { "cache-control": "no-store" } },
    );
  }
}
