import { NextResponse } from "next/server";
import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { DEFAULT_PREFS, normalizePrefs, type Prefs } from "@/lib/prefs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Layout prefs live next to the synced registry, in the env's own (gitignored)
// data/ dir — so dev and prod each keep their own, shared across all devices
// hitting that instance. Overridable for local dev via JARVIS_PREFS_PATH.
function prefsPath(): string {
  return process.env.JARVIS_PREFS_PATH ?? join(process.cwd(), "data", "prefs.json");
}

// GET /api/prefs — the saved layout, or defaults if none written yet.
export function GET() {
  let prefs: Prefs = DEFAULT_PREFS;
  try {
    prefs = normalizePrefs(JSON.parse(readFileSync(prefsPath(), "utf8")));
  } catch { /* missing/corrupt → defaults */ }
  return NextResponse.json(prefs, { headers: { "cache-control": "no-store" } });
}

// PUT /api/prefs — replace the saved layout (client sends the full Prefs blob).
export async function PUT(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const prefs = normalizePrefs(body);
  try {
    const path = prefsPath();
    mkdirSync(dirname(path), { recursive: true });
    // Atomic write: temp file + rename, so a crash mid-write can't truncate prefs.json.
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(prefs, null, 2) + "\n");
    renameSync(tmp, path);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
