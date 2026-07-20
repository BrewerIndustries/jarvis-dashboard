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

async function hostInfo() {
  const cpus = os.cpus();
  const arch = os.arch();
  const gpu = await detectGpu();
  return {
    mem: memInfo(),
    specs: {
      cpu: cpus.length ? cleanCpu(cpus[0].model) : "unknown",
      cores: cpus.length,
      arch: arch === "x64" ? "x86_64" : arch,
      gpu,
    },
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
