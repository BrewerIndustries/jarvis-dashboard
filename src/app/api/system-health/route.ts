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

// --- platform / runtime stack ------------------------------------------------
// The software the projects run on (Node, Docker, nginx, …). Versions only change
// on upgrade/redeploy, so detect once and cache for the process lifetime.

interface PlatformItem { name: string; version: string }

function osString(): string {
  try {
    const raw = readFileSync("/etc/os-release", "utf8");
    const get = (k: string) => raw.match(new RegExp(`^${k}="?([^"\\n]+)"?`, "m"))?.[1] ?? "";
    return [get("NAME"), get("VERSION_ID")].filter(Boolean).join(" ");
  } catch { return ""; }
}

// systemd services get a minimal PATH; nginx/tailscale live in sbin — widen it.
const VERSION_SCRIPT =
  "export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH; " +
  'echo "docker|$(docker --version 2>/dev/null)"; ' +
  'echo "nginx|$(nginx -v 2>&1)"; ' +
  'echo "python|$(python3 --version 2>&1)"; ' +
  'echo "tailscale|$(tailscale version 2>/dev/null | head -1)"';

let platformCache: PlatformItem[] | undefined;
function detectPlatform(): Promise<PlatformItem[]> {
  if (platformCache !== undefined) return Promise.resolve(platformCache);
  return new Promise((resolve) => {
    exec(VERSION_SCRIPT, { timeout: 4000 }, (_err, stdout) => {
      const raw: Record<string, string> = {};
      for (const line of (stdout || "").split("\n")) {
        const i = line.indexOf("|");
        if (i > 0) raw[line.slice(0, i)] = line.slice(i + 1).trim();
      }
      const items: PlatformItem[] = [];
      const push = (name: string, version: string) => { if (version) items.push({ name, version }); };
      push("OS", osString());
      push("Node", process.version.replace(/^v/, "")); // the runtime executing this code
      push("Docker", (raw.docker?.match(/Docker version ([^,]+)/)?.[1] ?? "").trim());
      push("nginx", (raw.nginx?.match(/nginx\/([0-9.]+)/)?.[1] ?? "").trim());
      push("Python", (raw.python ?? "").replace(/^Python\s+/, "").trim());
      push("Tailscale", (raw.tailscale ?? "").trim());
      platformCache = items;
      resolve(items);
    });
  });
}

async function hostInfo() {
  const cpus = os.cpus();
  const arch = os.arch();
  const [gpu, platform] = await Promise.all([detectGpu(), detectPlatform()]);
  return {
    mem: memInfo(),
    specs: {
      cpu: cpus.length ? cleanCpu(cpus[0].model) : "unknown",
      cores: cpus.length,
      arch: arch === "x64" ? "x86_64" : arch,
      gpu,
    },
    platform,
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
