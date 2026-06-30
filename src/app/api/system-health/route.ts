import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const JARVIS_URL = process.env.JARVIS_URL ?? "http://localhost:8080";

async function fetchJson(url: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
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
