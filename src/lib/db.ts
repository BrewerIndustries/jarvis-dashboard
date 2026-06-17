import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { dirname, join } from "path";
import { randomUUID } from "crypto";
import {
  AREAS,
  ITEM_KINDS,
  ITEM_PRIORITIES,
  ITEM_STATUSES,
  type Area,
  type Item,
  type ItemKind,
  type ItemPriority,
  type ItemStatus,
} from "./types";

const DB_PATH =
  process.env.JARVIS_DB_PATH ?? join(process.cwd(), "data", "jarvis.db");

// In dev, Next.js reloads modules on every change; cache the connection so we
// don't open a new handle (and re-run migrations) on each request.
const globalForDb = globalThis as unknown as { _jarvisDb?: Database.Database };

function init(): Database.Database {
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS items (
      id        TEXT PRIMARY KEY,
      parentId  TEXT,
      area      TEXT,
      kind      TEXT NOT NULL DEFAULT 'task',
      title     TEXT NOT NULL,
      body      TEXT,
      status    TEXT NOT NULL DEFAULT 'todo',
      priority  TEXT NOT NULL DEFAULT 'normal',
      source    TEXT,
      url       TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_items_parent ON items(parentId);
    CREATE INDEX IF NOT EXISTS idx_items_updated ON items(updatedAt);
  `);

  // Migrate older databases that predate parentId/area.
  const cols = (db.prepare(`PRAGMA table_info(items)`).all() as { name: string }[]).map(
    (c) => c.name,
  );
  if (!cols.includes("parentId")) db.exec(`ALTER TABLE items ADD COLUMN parentId TEXT`);
  if (!cols.includes("area")) db.exec(`ALTER TABLE items ADD COLUMN area TEXT`);

  return db;
}

export function getDb(): Database.Database {
  if (!globalForDb._jarvisDb) globalForDb._jarvisDb = init();
  return globalForDb._jarvisDb;
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function nullableStr(value: unknown): string | null {
  const s = str(value);
  return s ? s : null;
}

function areaOrNull(value: unknown): Area | null {
  const s = str(value);
  return (AREAS as readonly string[]).includes(s) ? (s as Area) : null;
}

// --- low-level node creation -------------------------------------------------

interface NodeFields {
  parentId: string | null;
  area: Area | null;
  kind: ItemKind;
  title: string;
  body?: string | null;
  status?: ItemStatus;
  priority?: ItemPriority;
  source?: string | null;
  url?: string | null;
}

function insertNode(f: NodeFields): Item {
  const now = new Date().toISOString();
  const item: Item = {
    id: randomUUID(),
    parentId: f.parentId,
    area: f.area,
    kind: f.kind,
    title: f.title,
    body: f.body ?? null,
    status: f.status ?? "todo",
    priority: f.priority ?? "normal",
    source: f.source ?? null,
    url: f.url ?? null,
    createdAt: now,
    updatedAt: now,
  };
  getDb()
    .prepare(
      `INSERT INTO items (id, parentId, area, kind, title, body, status, priority, source, url, createdAt, updatedAt)
       VALUES (@id, @parentId, @area, @kind, @title, @body, @status, @priority, @source, @url, @createdAt, @updatedAt)`,
    )
    .run(item);
  return item;
}

/** Find a child of `parentId` with a matching (case-insensitive) title + kind. */
function findChildByTitle(
  parentId: string | null,
  title: string,
  kind: ItemKind,
): Item | undefined {
  return getDb()
    .prepare(
      `SELECT * FROM items WHERE kind = ? AND title = ? COLLATE NOCASE AND parentId IS ?`,
    )
    .get(kind, title, parentId) as Item | undefined;
}

function setArea(id: string, area: Area) {
  getDb()
    .prepare(`UPDATE items SET area = ?, updatedAt = ? WHERE id = ?`)
    .run(area, new Date().toISOString(), id);
}

/**
 * Resolve (creating if needed) the container a task/note should hang under,
 * given human-friendly project/subproject names. Returns the container id.
 */
function resolveContainer(
  projectName: string,
  subprojectName: string,
  area: Area | null,
): string {
  let project = findChildByTitle(null, projectName, "project");
  if (!project) {
    project = insertNode({
      parentId: null,
      area: area ?? "in_progress",
      kind: "project",
      title: projectName,
    });
  } else if (area && project.area !== area) {
    setArea(project.id, area);
  }

  if (!subprojectName) return project.id;

  let sub = findChildByTitle(project.id, subprojectName, "subproject");
  if (!sub) {
    sub = insertNode({
      parentId: project.id,
      area: null,
      kind: "subproject",
      title: subprojectName,
    });
  }
  return sub.id;
}

// --- public API --------------------------------------------------------------

export interface CreateItemInput {
  title?: unknown;
  kind?: unknown;
  /** Name of the parent project (auto-created if missing). */
  project?: unknown;
  /** Name of the parent sub-project under `project` (auto-created if missing). */
  subproject?: unknown;
  /** Explicit parent id (advanced; overrides project/subproject). */
  parentId?: unknown;
  area?: unknown;
  status?: unknown;
  priority?: unknown;
  body?: unknown;
  source?: unknown;
  url?: unknown;
}

/**
 * Create (or upsert, for projects/sub-projects) an item from an arbitrary
 * payload. Returns the resulting item, or null if the payload is unusable.
 */
export function createItem(input: CreateItemInput): Item | null {
  const kind = oneOf<ItemKind>(input.kind, ITEM_KINDS, "task");
  const area = areaOrNull(input.area);
  const projectName = str(input.project);
  const subprojectName = str(input.subproject);
  const explicitParent = nullableStr(input.parentId);
  const title = str(input.title);

  const common = {
    body: nullableStr(input.body),
    status: oneOf<ItemStatus>(input.status, ITEM_STATUSES, "todo"),
    priority: oneOf<ItemPriority>(input.priority, ITEM_PRIORITIES, "normal"),
    source: nullableStr(input.source),
    url: nullableStr(input.url),
  };

  // Creating / updating a top-level project.
  if (kind === "project") {
    const name = title || projectName;
    if (!name) return null;
    const existing = findChildByTitle(null, name, "project");
    if (existing) {
      // Re-pushing an existing project can update its area and/or description.
      const patch: UpdateItemInput = {};
      if (area) patch.area = area;
      if (common.body != null) patch.body = common.body;
      return Object.keys(patch).length ? updateItem(existing.id, patch) : existing;
    }
    return insertNode({ parentId: null, area: area ?? "in_progress", kind, title: name, ...common });
  }

  // Creating / updating a sub-project.
  if (kind === "subproject") {
    const name = title || subprojectName;
    if (!name || !projectName) return null; // a sub-project needs a parent project
    const projectId = resolveContainer(projectName, "", area);
    const existing = findChildByTitle(projectId, name, "subproject");
    if (existing) {
      return common.body != null ? updateItem(existing.id, { body: common.body }) : existing;
    }
    return insertNode({ parentId: projectId, area: null, kind, title: name, ...common });
  }

  // Leaf: task / note / blocker.
  if (!title) return null;
  let parentId: string | null = explicitParent;
  if (!parentId && projectName) {
    parentId = resolveContainer(projectName, subprojectName, area);
  }
  // Loose items (no project) keep an area so they can land in a lane.
  return insertNode({
    parentId,
    area: parentId ? null : area ?? "in_progress",
    kind,
    title,
    ...common,
  });
}

export function listItems(): Item[] {
  return getDb().prepare(`SELECT * FROM items ORDER BY updatedAt DESC`).all() as Item[];
}

export interface UpdateItemInput {
  status?: unknown;
  priority?: unknown;
  title?: unknown;
  body?: unknown;
  area?: unknown;
  kind?: unknown;
  url?: unknown;
  parentId?: unknown;
}

export function updateItem(id: string, patch: UpdateItemInput): Item | null {
  const db = getDb();
  const existing = db.prepare(`SELECT * FROM items WHERE id = ?`).get(id) as Item | undefined;
  if (!existing) return null;

  const next: Item = {
    ...existing,
    status:
      patch.status !== undefined
        ? oneOf(patch.status, ITEM_STATUSES, existing.status)
        : existing.status,
    priority:
      patch.priority !== undefined
        ? oneOf(patch.priority, ITEM_PRIORITIES, existing.priority)
        : existing.priority,
    kind: patch.kind !== undefined ? oneOf(patch.kind, ITEM_KINDS, existing.kind) : existing.kind,
    area: patch.area !== undefined ? areaOrNull(patch.area) : existing.area,
    title: str(patch.title) || existing.title,
    body: patch.body !== undefined ? nullableStr(patch.body) : existing.body,
    url: patch.url !== undefined ? nullableStr(patch.url) : existing.url,
    parentId: patch.parentId !== undefined ? nullableStr(patch.parentId) : existing.parentId,
    updatedAt: new Date().toISOString(),
  };

  db.prepare(
    `UPDATE items SET parentId=@parentId, area=@area, kind=@kind, title=@title, body=@body,
       status=@status, priority=@priority, url=@url, updatedAt=@updatedAt WHERE id=@id`,
  ).run(next);
  return next;
}

/** Delete an item and all of its descendants. Returns count removed (0 if not found). */
export function deleteItem(id: string): number {
  const db = getDb();
  const exists = db.prepare(`SELECT 1 FROM items WHERE id = ?`).get(id);
  if (!exists) return 0;
  const childStmt = db.prepare(`SELECT id FROM items WHERE parentId = ?`);
  const toDelete: string[] = [];
  const queue = [id];
  while (queue.length) {
    const current = queue.shift()!;
    toDelete.push(current);
    for (const row of childStmt.all(current) as { id: string }[]) queue.push(row.id);
  }
  const del = db.prepare(`DELETE FROM items WHERE id = ?`);
  const tx = db.transaction((ids: string[]) => ids.forEach((x) => del.run(x)));
  tx(toDelete);
  return toDelete.length;
}
