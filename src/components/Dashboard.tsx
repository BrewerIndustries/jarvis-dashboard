"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AREA_LABEL,
  AREAS,
  isContainer,
  type Area,
  type Item,
  type ItemStatus,
  type TreeItem,
} from "@/lib/types";

// --- presentation maps -------------------------------------------------------

const STATUS_BADGE: Record<ItemStatus, { label: string; color: string }> = {
  todo: { label: "TODO", color: "var(--dos-gray)" },
  in_progress: { label: "WIP ", color: "var(--dos-cyan-bright)" },
  blocked: { label: "BLK!", color: "var(--dos-red)" },
  done: { label: "DONE", color: "var(--dos-green)" },
};

const KIND_GLYPH: Record<string, string> = {
  task: "·",
  note: "≡",
  blocker: "▓",
};

const PRIORITY: Record<string, { mark: string; color: string }> = {
  low: { mark: "", color: "var(--dos-gray)" },
  normal: { mark: "", color: "var(--dos-gray)" },
  high: { mark: "!!", color: "var(--dos-amber)" },
  urgent: { mark: "!!!", color: "var(--dos-red)" },
};

const AREA_COLOR: Record<Area, string> = {
  live: "var(--dos-green)",
  in_progress: "var(--dos-cyan-bright)",
  mothballed: "var(--dos-amber)",
};

/** Per-project deployment health, keyed by project title (from /api/health). */
type DeployHealth = Record<string, { state: string; ms?: number }>;

// --- helpers -----------------------------------------------------------------

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

function buildTree(items: Item[]): TreeItem[] {
  const byId = new Map<string, TreeItem>();
  for (const it of items) byId.set(it.id, { ...it, children: [] });
  const roots: TreeItem[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const rank = { urgent: 0, high: 1, normal: 2, low: 3 } as Record<string, number>;
  const sortRec = (list: TreeItem[]) => {
    list.sort((a, b) => {
      // containers first, then by priority, then title
      const ac = isContainer(a.kind) ? 0 : 1;
      const bc = isContainer(b.kind) ? 0 : 1;
      return (
        ac - bc ||
        (rank[a.priority] ?? 2) - (rank[b.priority] ?? 2) ||
        a.title.localeCompare(b.title)
      );
    });
    list.forEach((n) => sortRec(n.children));
  };
  sortRec(roots);
  return roots;
}

function buildPrefix(ancestorsLast: boolean[]): string {
  if (ancestorsLast.length === 0) return "";
  let s = "";
  for (let i = 0; i < ancestorsLast.length - 1; i++) s += ancestorsLast[i] ? "    " : "│   ";
  s += ancestorsLast[ancestorsLast.length - 1] ? "└── " : "├── ";
  return s;
}

// --- main --------------------------------------------------------------------

export default function Dashboard({ env }: { env?: string | null }) {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [hideDone, setHideDone] = useState(true);
  const [token, setToken] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [now, setNow] = useState(0);
  const [health, setHealth] = useState<{ env?: string; apps: DeployHealth }>({ apps: {} });
  const [lanes, setLanes] = useState<Record<string, string>>({});

  useEffect(() => {
    setToken(localStorage.getItem("jarvis-token") ?? "");
    try {
      setCollapsed(new Set(JSON.parse(localStorage.getItem("jarvis-collapsed") ?? "[]")));
    } catch {
      /* ignore */
    }
    setNow(Date.now());
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/items", { cache: "no-store" });
      const data = await res.json();
      setItems(data.items ?? []);
    } catch {
      /* keep last good state */
    } finally {
      setLoading(false);
      setNow(Date.now());
    }
  }, []);

  const refreshHealth = useCallback(async () => {
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      const data = await res.json();
      setHealth({ env: data.env, apps: data.apps ?? {} });
    } catch {
      /* keep last good health */
    }
  }, []);

  const refreshRegistry = useCallback(async () => {
    try {
      const res = await fetch("/api/registry", { cache: "no-store" });
      const data = await res.json();
      const map: Record<string, string> = {};
      for (const [name, info] of Object.entries(data.projects ?? {})) {
        const lane = (info as { lane?: string }).lane;
        if (lane) map[name] = lane;
      }
      setLanes(map);
    } catch {
      /* keep last good lanes */
    }
  }, []);

  useEffect(() => {
    refresh();
    refreshRegistry();
    refreshHealth();
    const t = setInterval(() => {
      refresh();
      refreshRegistry();
      refreshHealth();
    }, 8000);
    return () => clearInterval(t);
  }, [refresh, refreshRegistry, refreshHealth]);

  const toggle = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      localStorage.setItem("jarvis-collapsed", JSON.stringify([...next]));
      return next;
    });
  }, []);

  const saveToken = (v: string) => {
    setToken(v);
    localStorage.setItem("jarvis-token", v);
  };

  const mutate = useCallback(
    async (id: string, patch: Partial<Item>) => {
      setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
      await fetch(`/api/items/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-jarvis-token": token },
        body: JSON.stringify(patch),
      });
      refresh();
    },
    [token, refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      setItems((prev) => prev.filter((it) => it.id !== id));
      await fetch(`/api/items/${id}`, { method: "DELETE", headers: { "x-jarvis-token": token } });
      refresh();
    },
    [token, refresh],
  );

  const cycleStatus = useCallback(
    (it: Item) => {
      const order: ItemStatus[] = ["todo", "in_progress", "blocked", "done"];
      mutate(it.id, { status: order[(order.indexOf(it.status) + 1) % order.length] });
    },
    [mutate],
  );

  const cycleArea = useCallback(
    (it: Item) => {
      const cur = (it.area ?? "in_progress") as Area;
      const next = AREAS[(AREAS.indexOf(cur) + 1) % AREAS.length];
      mutate(it.id, { area: next });
    },
    [mutate],
  );

  // filter -> tree -> group by area
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((it) => {
      if (hideDone && it.status === "done" && !isContainer(it.kind)) return false;
      if (!q) return true;
      return (
        it.title.toLowerCase().includes(q) ||
        (it.body ?? "").toLowerCase().includes(q)
      );
    });
  }, [items, query, hideDone]);

  const tree = useMemo(() => buildTree(filtered), [filtered]);

  const byArea = useMemo(() => {
    const map: Record<Area, TreeItem[]> = { live: [], in_progress: [], mothballed: [] };
    for (const node of tree) {
      // Declared status from the shared registry wins (per-environment); a project
      // not in the registry keeps its hand-set lane.
      const declared = lanes[node.title] as Area | undefined;
      const area = (declared ?? node.area ?? "in_progress") as Area;
      (map[area] ?? map.in_progress).push(node);
    }
    return map;
  }, [tree, lanes]);

  const stats = useMemo(() => {
    const projects = items.filter((i) => i.kind === "project").length;
    const blocked = items.filter((i) => i.status === "blocked").length;
    return { projects, blocked };
  }, [items]);

  const handlers = { toggle, mutate, remove, cycleStatus, cycleArea, collapsed };

  return (
    <div className="crt min-h-screen">
      {env && <EnvBanner env={env} />}
      <div className="px-3 py-4 sm:px-6 sm:py-6">
      <div className="mx-auto max-w-[1600px]">
        <Header stats={stats} query={query} setQuery={setQuery} hideDone={hideDone} setHideDone={setHideDone} />

        <main className="mt-4 grid items-start gap-4 lg:grid-cols-3">
          {loading ? (
            <p className="px-1 text-[var(--dos-gray)]">C:\JARVIS&gt; loading<span className="cursor" /></p>
          ) : (
            AREAS.map((area) => (
              <AreaSection
                key={area}
                area={area}
                nodes={byArea[area]}
                collapsed={collapsed}
                toggle={toggle}
                handlers={handlers}
                now={now}
                health={health.apps}
                lanes={lanes}
              />
            ))
          )}
        </main>

        <StatusBar stats={stats} now={now} />
      </div>
      </div>

      <TokenBar token={token} onSave={saveToken} />
    </div>
  );
}

// --- environment banner (DEV / non-prod) -------------------------------------

function EnvBanner({ env }: { env: string }) {
  return (
    <div className="dos-env-banner sticky top-0 z-[65] flex items-center justify-center gap-2 px-3 py-1 text-center text-sm font-bold uppercase tracking-[0.25em]">
      <span aria-hidden>▓▒░</span>
      <span>
        ⚠ {env} environment <span className="opacity-70">— not production</span>
      </span>
      <span aria-hidden>░▒▓</span>
    </div>
  );
}

// --- header ------------------------------------------------------------------

function Header({
  stats,
  query,
  setQuery,
  hideDone,
  setHideDone,
}: {
  stats: { projects: number; blocked: number };
  query: string;
  setQuery: (v: string) => void;
  hideDone: boolean;
  setHideDone: (v: boolean) => void;
}) {
  return (
    <header className="dos-box">
      <div className="dos-bar flex items-center gap-2 px-3 py-1 text-sm font-bold tracking-wider">
        <span>▓▒░</span>
        <span>JARVIS.SYS — PROJECT CONTROL</span>
        <span className="ml-auto hidden sm:inline">v1.0</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-3 py-2 text-sm">
        <span className="glow font-bold text-[var(--dos-cyan-bright)]">
          ████ JARVIS<span className="cursor" />
        </span>
        <span className="text-[var(--dos-gray)]">
          PROJECTS:<b className="text-[var(--dos-white)]"> {stats.projects}</b>
        </span>
        {stats.blocked > 0 && (
          <span style={{ color: "var(--dos-red)" }}>BLOCKED: {stats.blocked}</span>
        )}
        <div className="ml-auto flex items-center gap-3">
          <span className="text-[var(--dos-gray)]">
            FIND:
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="dos-input ml-1 w-36 px-2 py-0.5 text-sm"
              placeholder="_"
            />
          </span>
          <button
            onClick={() => setHideDone(!hideDone)}
            className="px-1 text-sm text-[var(--dos-cyan-bright)] hover:text-[var(--dos-white)]"
            title="Toggle visibility of done items"
          >
            [{hideDone ? "X" : " "}] hide done
          </button>
        </div>
      </div>
    </header>
  );
}

// --- area section ------------------------------------------------------------

function AreaSection({
  area,
  nodes,
  collapsed,
  toggle,
  handlers,
  now,
  health,
  lanes,
}: {
  area: Area;
  nodes: TreeItem[];
  collapsed: Set<string>;
  toggle: (id: string) => void;
  handlers: Handlers;
  now: number;
  health: DeployHealth;
  lanes: Record<string, string>;
}) {
  const key = `area:${area}`;
  const isClosed = collapsed.has(key);
  const projects = nodes.filter((n) => isContainer(n.kind)).length;

  return (
    <section className="dos-box">
      <button
        onClick={() => toggle(key)}
        className="dos-bar flex w-full items-center gap-2 px-3 py-1 text-left text-sm font-bold tracking-wider"
        style={{ background: AREA_COLOR[area] }}
      >
        <span className="w-4">{isClosed ? "►" : "▼"}</span>
        <span>■ {AREA_LABEL[area]}</span>
        <span className="ml-auto font-normal opacity-80">{projects} proj</span>
      </button>

      <div className={`collapse-anim ${isClosed ? "closed" : ""}`}>
        <div className="flex flex-col gap-2 p-2">
          {nodes.length === 0 ? (
            <p className="px-2 py-3 text-center text-sm text-[var(--dos-gray)]">— empty —</p>
          ) : (
            nodes.map((node) =>
              isContainer(node.kind) ? (
                <ProjectCard key={node.id} node={node} collapsed={collapsed} handlers={handlers} now={now} health={health} lanes={lanes} />
              ) : (
                <div key={node.id} className="dos-box px-2 py-1">
                  <LeafRow node={node} prefix="" handlers={handlers} now={now} />
                </div>
              ),
            )
          )}
        </div>
      </div>
    </section>
  );
}

// --- project card (top-level container) --------------------------------------

interface Handlers {
  toggle: (id: string) => void;
  mutate: (id: string, patch: Partial<Item>) => void;
  remove: (id: string) => void;
  cycleStatus: (it: Item) => void;
  cycleArea: (it: Item) => void;
  collapsed: Set<string>;
}

function ProjectCard({
  node,
  collapsed,
  handlers,
  now,
  health,
  lanes,
}: {
  node: TreeItem;
  collapsed: Set<string>;
  handlers: Handlers;
  now: number;
  health: DeployHealth;
  lanes: Record<string, string>;
}) {
  const isClosed = collapsed.has(node.id);
  const status = health[node.title];
  const registryManaged = node.title in lanes;

  return (
    <div className="dos-box">
      <div className="group">
        <div className="flex items-start gap-2 px-2 py-1">
          <button onClick={() => handlers.toggle(node.id)} className="flex min-w-0 flex-1 items-start gap-2 text-left">
            <span className="w-5 shrink-0 text-[var(--dos-cyan-bright)]">[{isClosed ? "+" : "−"}]</span>
            <span className="glow min-w-0 break-words font-bold text-[var(--dos-bright)]">{node.title}</span>
          </button>
          {status ? (
            <span
              title={`deployment ${status.state}${status.ms != null ? ` · ${status.ms}ms` : ""} — lane is declared in the repo's .jarvis.json`}
              className="shrink-0 pt-0.5 text-xs font-bold tracking-wide"
              style={{ color: status.state === "online" ? "var(--dos-green)" : "var(--dos-red)" }}
            >
              {status.state === "online" ? "● LIVE" : "○ DOWN"}
            </span>
          ) : registryManaged ? (
            <span
              title="Lane is declared in the repo's .jarvis.json (no deployment to ping)"
              className="shrink-0 pt-0.5 text-[10px] uppercase tracking-wider text-[var(--dos-gray)]"
            >
              declared
            </span>
          ) : (
            <button
              onClick={() => handlers.cycleArea(node)}
              title="Move to next lane (LIVE → IN PROGRESS → MOTHBALLED)"
              className="shrink-0 text-[var(--dos-cyan)] opacity-0 transition group-hover:opacity-100 hover:text-[var(--dos-cyan-bright)]"
            >
              ⇄
            </button>
          )}
          <button
            onClick={() => handlers.remove(node.id)}
            title="Delete project and everything under it"
            className="shrink-0 text-[var(--dos-gray)] opacity-0 transition group-hover:opacity-100 hover:text-[var(--dos-red)]"
          >
            ✕
          </button>
        </div>
        <Description node={node} handlers={handlers} indent="2rem" />
      </div>

      <div className={`collapse-anim ${isClosed ? "closed" : ""}`}>
        <div className="px-2 pb-1">
          {node.children.length === 0 ? (
            <p className="py-1 pl-5 text-xs text-[var(--dos-gray)]">└── (no items yet)</p>
          ) : (
            node.children.map((child, i) => (
              <TreeNode
                key={child.id}
                node={child}
                ancestorsLast={[i === node.children.length - 1]}
                collapsed={collapsed}
                handlers={handlers}
                now={now}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// --- recursive node (sub-projects + leaves) ----------------------------------

function TreeNode({
  node,
  ancestorsLast,
  collapsed,
  handlers,
  now,
}: {
  node: TreeItem;
  ancestorsLast: boolean[];
  collapsed: Set<string>;
  handlers: Handlers;
  now: number;
}) {
  const prefix = buildPrefix(ancestorsLast);

  if (!isContainer(node.kind)) {
    return <LeafRow node={node} prefix={prefix} handlers={handlers} now={now} />;
  }

  // sub-project
  const isClosed = collapsed.has(node.id);
  return (
    <div>
      <div className="group">
        <div className="flex items-start gap-1 py-0.5">
          <button onClick={() => handlers.toggle(node.id)} className="flex min-w-0 flex-1 items-start gap-1 text-left">
            <span className="shrink-0 whitespace-pre text-[var(--dos-cyan)]">{prefix}</span>
            <span className="shrink-0 text-[var(--dos-cyan-bright)]">[{isClosed ? "+" : "−"}]</span>
            <span className="glow min-w-0 break-words font-bold text-[var(--dos-white)]">{node.title}</span>
          </button>
          <button
            onClick={() => handlers.remove(node.id)}
            className="shrink-0 text-[var(--dos-gray)] opacity-0 transition group-hover:opacity-100 hover:text-[var(--dos-red)]"
          >
            ✕
          </button>
        </div>
        <Description node={node} handlers={handlers} indent={`${4 * ancestorsLast.length + 4}ch`} />
      </div>
      <div className={`collapse-anim ${isClosed ? "closed" : ""}`}>
        <div>
          {node.children.map((child, i) => (
            <TreeNode
              key={child.id}
              node={child}
              ancestorsLast={[...ancestorsLast, i === node.children.length - 1]}
              collapsed={collapsed}
              handlers={handlers}
              now={now}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// --- editable description for projects / sub-projects ------------------------

function Description({
  node,
  handlers,
  indent,
}: {
  node: TreeItem;
  handlers: Handlers;
  indent: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(node.body ?? "");
  useEffect(() => {
    if (!editing) setDraft(node.body ?? "");
  }, [node.body, editing]);

  const save = () => {
    handlers.mutate(node.id, { body: draft.trim() });
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="pb-1 pr-2 pt-0.5" style={{ paddingLeft: indent }}>
        <textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          placeholder="Description…"
          className="dos-input w-full px-2 py-1 text-xs"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
            if (e.key === "Escape") setEditing(false);
          }}
        />
        <div className="mt-1 flex items-center gap-3 text-xs">
          <button onClick={save} className="dos-bar px-2 py-0.5 font-bold">
            SAVE
          </button>
          <button onClick={() => setEditing(false)} className="text-[var(--dos-gray)] hover:text-[var(--dos-white)]">
            cancel
          </button>
          <span className="text-[var(--dos-gray)]">⌘↵ save · esc cancel</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2 pb-0.5 pr-2 text-xs" style={{ paddingLeft: indent }}>
      {node.body ? (
        <p className="whitespace-pre-wrap italic text-[var(--dos-gray)]">{node.body}</p>
      ) : (
        <span className="italic text-[var(--dos-gray)] opacity-0 transition group-hover:opacity-50">
          no description
        </span>
      )}
      <button
        onClick={() => setEditing(true)}
        title="Edit description"
        className="shrink-0 not-italic text-[var(--dos-cyan)] opacity-0 transition group-hover:opacity-100 hover:text-[var(--dos-cyan-bright)]"
      >
        ✎
      </button>
    </div>
  );
}

function LeafRow({
  node,
  prefix,
  handlers,
  now,
}: {
  node: TreeItem;
  prefix: string;
  handlers: Handlers;
  now: number;
}) {
  const badge = STATUS_BADGE[node.status];
  const pri = PRIORITY[node.priority];
  const done = node.status === "done";
  return (
    <div className="group flex items-start gap-1 py-0.5 text-sm" style={{ opacity: done ? 0.55 : 1 }}>
      <span className="shrink-0 whitespace-pre pt-0.5 text-[var(--dos-cyan)]">{prefix}</span>
      <button
        onClick={() => handlers.cycleStatus(node)}
        title="Click to change status"
        className="shrink-0 whitespace-pre pt-0.5 font-bold"
        style={{ color: badge.color }}
      >
        [{badge.label}]
      </button>
      <span className="shrink-0 pt-0.5" style={{ color: node.kind === "blocker" ? "var(--dos-red)" : "var(--dos-gray)" }}>
        {KIND_GLYPH[node.kind] ?? "·"}
      </span>
      <div className="min-w-0 flex-1">
        <span className="break-words text-[var(--dos-white)]">
          {node.url ? (
            <a href={node.url} target="_blank" rel="noreferrer" className="hover:text-[var(--dos-cyan-bright)] hover:underline">
              {node.title}
            </a>
          ) : (
            node.title
          )}
          {pri.mark && (
            <span className="ml-1.5 font-bold" style={{ color: pri.color }}>
              {pri.mark}
            </span>
          )}
        </span>
        {node.body && <p className="whitespace-pre-wrap text-xs text-[var(--dos-gray)]">{node.body}</p>}
        <span className="ml-2 inline-block text-[11px] text-[var(--dos-gray)]">
          {node.source && <span>{node.source} · </span>}
          {now ? timeAgo(node.updatedAt) : ""}
        </span>
      </div>
      <button
        onClick={() => handlers.remove(node.id)}
        className="shrink-0 text-[var(--dos-gray)] opacity-0 transition group-hover:opacity-100 hover:text-[var(--dos-red)]"
      >
        ✕
      </button>
    </div>
  );
}

// --- status bar + token ------------------------------------------------------

function StatusBar({
  stats,
  now,
}: {
  stats: { projects: number; blocked: number };
  now: number;
}) {
  return (
    <footer className="dos-bar mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-1 text-xs font-bold tracking-wide">
      <span>F5 = auto-refresh (8s)</span>
      <span>{stats.projects} PROJ</span>
      {stats.blocked > 0 && <span>{stats.blocked} BLOCKED</span>}
      <span className="ml-auto">
        {now ? new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "--:--"}
      </span>
    </footer>
  );
}

function TokenBar({ token, onSave }: { token: string; onSave: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(token);
  useEffect(() => setDraft(token), [token]);

  return (
    <div className="fixed bottom-3 right-3 z-[70] text-xs">
      {open ? (
        <div className="dos-box flex items-center gap-2 p-2">
          <input
            type="password"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="JARVIS_TOKEN"
            className="dos-input w-44 px-2 py-1"
          />
          <button
            onClick={() => {
              onSave(draft);
              setOpen(false);
            }}
            className="dos-bar px-2 py-1 font-bold"
          >
            SAVE
          </button>
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="dos-box px-2 py-1 text-[var(--dos-white)] hover:text-[var(--dos-cyan-bright)]"
          title="Set the token used for edits from this browser"
        >
          🔑 {token ? "token set" : "set token"}
        </button>
      )}
    </div>
  );
}
