import { NextResponse } from "next/server";
import { activeEnv, laneFor, registry } from "@/lib/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/registry — full project card array for THIS environment.
// Each card carries its computed lane (per-env), plus all fields from the synced
// registry.json (name, description, version, lastCommit, backlog, repoUrl, liveUrl).
// Returns { env, cards: CardEntry[] }.
export function GET() {
  const env = activeEnv();
  const cards = registry().map((e) => ({ ...e, lane: laneFor(e, env) }));
  return NextResponse.json(
    { env, cards },
    { headers: { "cache-control": "no-store" } },
  );
}
