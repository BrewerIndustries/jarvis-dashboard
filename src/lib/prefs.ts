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

export interface Prefs {
  /** Manual per-lane card order (ids), applied only when sort === "custom". */
  order: Partial<Record<Lane, string[]>>;
  /** Per-lane collapsed state. */
  collapsed: Partial<Record<Lane, boolean>>;
  /** Active sort mode (global across lanes). */
  sort: SortMode;
}

export const DEFAULT_PREFS: Prefs = { order: {}, collapsed: {}, sort: "custom" };

// Coerce arbitrary parsed JSON into a valid Prefs — defensive against hand-edits
// of prefs.json and against older/newer shapes.
export function normalizePrefs(raw: unknown): Prefs {
  const p = (raw && typeof raw === "object" ? raw : {}) as Partial<Prefs>;
  const sort: SortMode = SORT_MODES.includes(p.sort as SortMode) ? (p.sort as SortMode) : "custom";
  return {
    order: p.order && typeof p.order === "object" ? p.order : {},
    collapsed: p.collapsed && typeof p.collapsed === "object" ? p.collapsed : {},
    sort,
  };
}
