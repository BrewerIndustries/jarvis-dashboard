import { NextResponse } from "next/server";
import { activeEnv, laneFor, registry } from "@/lib/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/registry — declared lifecycle lane per project for THIS environment.
// Fast (no network); drives which lane each registered project sits in.
// Returns { env, projects: { [name]: { lane } } }.
export function GET() {
  const env = activeEnv();
  const projects = Object.fromEntries(
    registry().map((e) => [e.name, { lane: laneFor(e, env) }]),
  );
  return NextResponse.json(
    { env, projects },
    { headers: { "cache-control": "no-store" } },
  );
}
