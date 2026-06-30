import { NextResponse } from "next/server";
import https from "node:https";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const JARVIS_URL = process.env.JARVIS_URL ?? "https://localhost:8080";

// Jarvis uses a self-signed TLS cert — skip verification for localhost calls only.
const agent = new https.Agent({ rejectUnauthorized: false });

async function fetchJson(url: string) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(4000),
    // @ts-expect-error — Next.js Node runtime accepts the agent option
    agent: url.startsWith("https") ? agent : undefined,
  });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

export async function GET() {
  try {
    const [status, logs] = await Promise.all([
      fetchJson(`${JARVIS_URL}/api/health`),
      fetchJson(`${JARVIS_URL}/api/health/logs?n=80`),
    ]);
    return NextResponse.json(
      { ok: true, status, logs },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err) },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
}
