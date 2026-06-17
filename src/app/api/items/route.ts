import { NextRequest, NextResponse } from "next/server";
import { createItem, listItems } from "@/lib/db";
import { isAuthorized } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/items — list everything (read is open; it's your own dashboard).
export function GET() {
  return NextResponse.json({ items: listItems() });
}

// POST /api/items — push a new item. Token required (if configured).
// Accepts one item object, or { items: [...] } for a batch.
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const batch = Array.isArray((payload as { items?: unknown })?.items)
    ? ((payload as { items: unknown[] }).items)
    : [payload];

  const created = batch
    .map((entry) => createItem(entry as Record<string, unknown>))
    .filter((x): x is NonNullable<typeof x> => x !== null);

  if (created.length === 0) {
    return NextResponse.json(
      { error: "no valid items (each needs a non-empty title)" },
      { status: 400 },
    );
  }

  return NextResponse.json({ created }, { status: 201 });
}
