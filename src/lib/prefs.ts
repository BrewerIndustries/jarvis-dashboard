// Shared dashboard layout preferences — manual card order, collapsed lanes, and
// sort mode. Persisted server-side as data/prefs.json (see app/api/prefs/route.ts)
// so a layout follows the user across devices, not just one browser.
//
// This module is fs-free on purpose: it's imported by both the client component
// and the server route. The route does its own file I/O.

import type { Lane } from "./registry";

export type SortMode = "custom" | "name" | "recent" | "backlog";

export const SORT_MODES: SortMode[] = ["custom", "name", "recent", "backlog"];

export const SORT_LABEL: Record<SortMode, string> = {
  custom: "Manual",
  name: "Name",
  recent: "Recent activity",
  backlog: "Backlog",
};

/** A user-created sub-group living inside one lane. Cards keep their
 *  registry-driven lane; a section just partitions a lane visually. */
export interface Section {
  /** Stable unique id (client-generated on create). */
  id: string;
  /** Which lane this section belongs to. */
  lane: Lane;
  /** User-editable display name. */
  name: string;
}

export interface Prefs {
  /** Manual per-lane card order (ids), applied only when sort === "custom". */
  order: Partial<Record<Lane, string[]>>;
  /** Per-lane collapsed state. */
  collapsed: Partial<Record<Lane, boolean>>;
  /** Active sort mode (global across lanes). */
  sort: SortMode;
  /** Custom sub-sections, in render order within their lane. */
  sections: Section[];
  /** Card id → section id assignment. A card is grouped only when its section
   *  still exists and shares the card's current lane; otherwise it's ungrouped. */
  sectionOf: Record<string, string>;
}

export const DEFAULT_PREFS: Prefs = {
  order: {},
  collapsed: {},
  sort: "custom",
  sections: [],
  sectionOf: {},
};

const LANES: Lane[] = ["live", "in_progress", "mothballed"];

// Coerce a parsed sections array into valid Section[] — drop anything malformed
// (bad lane, missing id/name) and de-dupe ids, keeping first occurrence.
function normalizeSections(raw: unknown): Section[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Section[] = [];
  for (const s of raw) {
    if (!s || typeof s !== "object") continue;
    const { id, lane, name } = s as Partial<Section>;
    if (typeof id !== "string" || !id || seen.has(id)) continue;
    if (!LANES.includes(lane as Lane)) continue;
    if (typeof name !== "string") continue;
    seen.add(id);
    out.push({ id, lane: lane as Lane, name });
  }
  return out;
}

// Card id → section id, keeping only string→string entries that point at a
// section that actually exists (orphans become ungrouped).
function normalizeSectionOf(raw: unknown, sections: Section[]): Record<string, string> {
  if (!raw || typeof raw !== "object") return {};
  const ids = new Set(sections.map((s) => s.id));
  const out: Record<string, string> = {};
  for (const [cardId, secId] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof secId === "string" && ids.has(secId)) out[cardId] = secId;
  }
  return out;
}

// Coerce arbitrary parsed JSON into a valid Prefs — defensive against hand-edits
// of prefs.json and against older/newer shapes.
export function normalizePrefs(raw: unknown): Prefs {
  const p = (raw && typeof raw === "object" ? raw : {}) as Partial<Prefs>;
  const sort: SortMode = SORT_MODES.includes(p.sort as SortMode) ? (p.sort as SortMode) : "custom";
  const sections = normalizeSections(p.sections);
  return {
    order: p.order && typeof p.order === "object" ? p.order : {},
    collapsed: p.collapsed && typeof p.collapsed === "object" ? p.collapsed : {},
    sort,
    sections,
    sectionOf: normalizeSectionOf(p.sectionOf, sections),
  };
}
