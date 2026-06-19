export const ITEM_KINDS = ["project", "subproject", "task", "note", "blocker"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export const AREAS = ["live", "in_progress", "ideas", "mothballed"] as const;
export type Area = (typeof AREAS)[number];

export const AREA_LABEL: Record<Area, string> = {
  live: "LIVE",
  in_progress: "IN PROGRESS",
  ideas: "IDEAS",
  mothballed: "MOTHBALLED",
};

export const ITEM_STATUSES = ["todo", "in_progress", "blocked", "done"] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export const ITEM_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type ItemPriority = (typeof ITEM_PRIORITIES)[number];

/** Kinds that act as containers (can hold sub-projects / tasks). */
export const CONTAINER_KINDS: ItemKind[] = ["project", "subproject"];
export const isContainer = (k: ItemKind) => CONTAINER_KINDS.includes(k);

export interface Item {
  id: string;
  /** null = top-level (a project, or a loose item). */
  parentId: string | null;
  /** Lane this belongs to. Meaningful on top-level nodes; children inherit visually. */
  area: Area | null;
  kind: ItemKind;
  title: string;
  body: string | null;
  status: ItemStatus;
  priority: ItemPriority;
  /** Where this came from, e.g. "claude-code:prosecutor-platform". */
  source: string | null;
  /** Optional deep link back to a PR, doc, task, etc. */
  url: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Item with its descendants attached — built client-side for rendering. */
export interface TreeItem extends Item {
  children: TreeItem[];
}
