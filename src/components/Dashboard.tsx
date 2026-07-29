"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Lane } from "@/lib/registry";
import { DEFAULT_PREFS, SORT_LABEL, SORT_MODES, type Prefs, type SortMode } from "@/lib/prefs";
import { applyPalette, computePalette } from "@/lib/ambientTheme";

// --- types -------------------------------------------------------------------

interface Card {
  id: string;
  name: string;
  description?: string;
  version?: string | null;
  category?: string;
  lane: Lane;
  lastCommit?: string | null;
  backlog?: number;
  repoUrl?: string;
  liveUrl?: string | null;
}

type HealthMap = Record<string, { state: string; ms?: number }>;

interface SystemHealth {
  disk: { pct: number; free_gb: number; ok: boolean };
  mem: { pct: number; ok: boolean };
  services: Record<string, boolean>;
  containers: Record<string, boolean>;
}

interface PlatformItem {
  name: string;
  version: string;
  group: string;
  outdated: boolean;
  latest?: string;
}

interface UpdateInfo {
  upgradable: number;
  security: number;
  reboot: boolean;
}

interface HostInfo {
  mem: { pct: number; used_gb: number; total_gb: number; ok: boolean };
  specs: { cpu: string; cores: number; arch: string; gpu: string | null };
  platform: PlatformItem[];
  updates: UpdateInfo | null;
}

type View = "projects" | "health";

// --- constants ---------------------------------------------------------------

const LANE_ORDER: Lane[] = ["live", "in_progress", "mothballed"];

const LANE_LABEL: Record<Lane, string> = {
  live: "Live",
  in_progress: "In Progress",
  mothballed: "Mothballed",
};

const LANE_COLOR: Record<Lane, string> = {
  live:        "var(--green)",
  in_progress: "var(--indigo-bright)",
  mothballed:  "var(--text-dim)",
};

const LANE_DOT_BG: Record<Lane, string> = {
  live:        "var(--green-dim)",
  in_progress: "var(--indigo-dim)",
  mothballed:  "rgba(255,255,255,0.05)",
};

// --- helpers -----------------------------------------------------------------

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d`;
  return `${Math.round(d / 30)}mo`;
}

// --- card ordering -----------------------------------------------------------
// Layout prefs (manual order, collapsed lanes, sort mode) are persisted
// server-side via /api/prefs — see src/lib/prefs.ts.

const byName = (a: Card, b: Card) => a.name.localeCompare(b.name);

// Apply a saved id order to a lane's cards; ids not in the saved order (e.g. a
// newly auto-discovered project) fall to the end, alphabetically.
function applyOrder(cards: Card[], order?: string[]): Card[] {
  if (!order || order.length === 0) return [...cards].sort(byName);
  const pos = new Map(order.map((id, i) => [id, i] as const));
  return [...cards].sort((a, b) => {
    const ai = pos.get(a.id) ?? Infinity;
    const bi = pos.get(b.id) ?? Infinity;
    return ai !== bi ? ai - bi : byName(a, b);
  });
}

// Order a lane's cards for the active sort mode.
function laneCards(cards: Card[], sort: SortMode, order?: string[]): Card[] {
  if (sort === "custom") return applyOrder(cards, order);
  const arr = [...cards];
  if (sort === "name") return arr.sort(byName);
  if (sort === "recent") {
    return arr.sort((a, b) => {
      const at = a.lastCommit ? Date.parse(a.lastCommit) : 0;
      const bt = b.lastCommit ? Date.parse(b.lastCommit) : 0;
      return bt - at || byName(a, b);
    });
  }
  // backlog — most open items first
  return arr.sort((a, b) => (b.backlog ?? 0) - (a.backlog ?? 0) || byName(a, b));
}

const ENV_URLS: Record<string, { label: string; url: string }> = {
  dev:  { label: "→ Prod", url: "http://100.102.159.57:4500" },
  prod: { label: "→ Dev",  url: "http://100.102.159.57:4510" },
};

// --- main --------------------------------------------------------------------

function useAmbientTheme() {
  useEffect(() => {
    applyPalette(computePalette());
    const t = setInterval(() => applyPalette(computePalette()), 60_000);
    return () => clearInterval(t);
  }, []);
}

export default function Dashboard({ env }: { env?: string | null }) {
  useAmbientTheme();
  const [view, setView] = useState<View>("projects");
  const [cards, setCards] = useState<Card[]>([]);
  const [health, setHealth] = useState<HealthMap>({});
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(0);
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [filter, setFilter] = useState("");
  const prefsLoaded = useRef(false);

  // Load the saved layout from the server once on mount.
  useEffect(() => {
    let alive = true;
    fetch("/api/prefs", { cache: "no-store" })
      .then((r) => r.json())
      .then((p: Prefs) => { if (alive) setPrefs(p); })
      .catch(() => { /* server down → keep defaults */ })
      .finally(() => { prefsLoaded.current = true; });
    return () => { alive = false; };
  }, []);

  // Apply + persist a layout change. Skips writes until the initial load resolves
  // so we never clobber saved prefs with the default state on first paint.
  const persist = useCallback((next: Prefs) => {
    setPrefs(next);
    if (!prefsLoaded.current) return;
    fetch("/api/prefs", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(next),
    }).catch(() => { /* offline — local state still updated */ });
  }, []);

  const toggleCollapse = (lane: Lane) =>
    persist({ ...prefs, collapsed: { ...prefs.collapsed, [lane]: !prefs.collapsed[lane] } });
  const reorderLane = (lane: Lane, ids: string[]) =>
    persist({ ...prefs, order: { ...prefs.order, [lane]: ids } });
  const setSort = (sort: SortMode) => persist({ ...prefs, sort });
  const setAllCollapsed = (collapsed: boolean) =>
    persist({ ...prefs, collapsed: Object.fromEntries(LANE_ORDER.map((l) => [l, collapsed])) });
  const resetLayout = () => persist(DEFAULT_PREFS);

  const hasCustomLayout =
    prefs.sort !== "custom" ||
    LANE_ORDER.some((l) => (prefs.order[l]?.length ?? 0) > 0 || prefs.collapsed[l]);
  const allCollapsed = LANE_ORDER.every((l) => prefs.collapsed[l]);

  const refreshCards = useCallback(async () => {
    try {
      const res = await fetch("/api/registry", { cache: "no-store" });
      const data = await res.json();
      setCards(data.cards ?? []);
    } catch { /* keep last */ }
    finally {
      setLoading(false);
      setNow(Date.now());
    }
  }, []);

  const refreshHealth = useCallback(async () => {
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      const data = await res.json();
      setHealth(data.apps ?? {});
    } catch { /* keep last */ }
  }, []);

  useEffect(() => {
    setNow(Date.now());
    refreshCards();
    refreshHealth();
    const t = setInterval(() => { refreshCards(); refreshHealth(); }, 8000);
    return () => clearInterval(t);
  }, [refreshCards, refreshHealth]);

  const q = filter.trim().toLowerCase();
  const filtering = q.length > 0;
  const filtered = filtering
    ? cards.filter((c) =>
        c.name.toLowerCase().includes(q) || (c.description ?? "").toLowerCase().includes(q))
    : cards;

  const byLane: Record<Lane, Card[]> = { live: [], in_progress: [], mothballed: [] };
  for (const card of filtered) {
    (byLane[card.lane] ?? byLane.in_progress).push(card);
  }

  // Header stats reflect the full inventory, not the current filter.
  const liveCount = cards.filter((c) => c.lane === "live").length;
  const totalCount = cards.length;
  const matchCount = filtered.length;

  return (
    <div style={{ minHeight: "100vh", background: "var(--base)" }}>
      {env && <EnvBanner env={env} />}

      <div style={{ maxWidth: 1600, margin: "0 auto", padding: "24px 20px" }}>
        <Header
          liveCount={liveCount}
          totalCount={totalCount}
          env={env}
          view={view}
          onViewChange={setView}
          canReset={view === "projects" && hasCustomLayout}
          onReset={resetLayout}
        />

        {view === "projects" && !loading && cards.length > 0 && (
          <ControlsBar
            filter={filter}
            onFilter={setFilter}
            sort={prefs.sort}
            onSort={setSort}
            allCollapsed={allCollapsed}
            onToggleAll={() => setAllCollapsed(!allCollapsed)}
            filtering={filtering}
            matchCount={matchCount}
            totalCount={totalCount}
          />
        )}

        <main style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 32 }}>
          {view === "health" ? (
            <HealthTab />
          ) : loading ? (
            <LoadingState />
          ) : cards.length === 0 ? (
            <EmptyState />
          ) : filtering && matchCount === 0 ? (
            <NoMatches query={filter} />
          ) : (
            LANE_ORDER.map((lane) => (
              <LaneSection
                key={lane}
                lane={lane}
                cards={laneCards(byLane[lane], prefs.sort, prefs.order[lane])}
                collapsed={filtering ? false : !!prefs.collapsed[lane]}
                draggable={prefs.sort === "custom" && !filtering}
                onToggleCollapse={() => toggleCollapse(lane)}
                onReorder={(ids) => reorderLane(lane, ids)}
                health={health}
                now={now}
              />
            ))
          )}
        </main>

        <StatusBar totalCount={totalCount} liveCount={liveCount} now={now} />
      </div>
    </div>
  );
}

// --- env banner --------------------------------------------------------------

function EnvBanner({ env }: { env: string }) {
  return (
    <div style={{
      position: "sticky", top: 0, zIndex: 65,
      background: "rgba(224,136,32,0.12)",
      borderBottom: "1px solid rgba(224,136,32,0.25)",
      backdropFilter: "blur(8px)",
      display: "flex", alignItems: "center", justifyContent: "center",
      gap: 8, padding: "7px 16px",
      fontSize: 11, fontWeight: 600,
      letterSpacing: "0.12em", textTransform: "uppercase",
      color: "var(--amber)",
    }}>
      <span style={{ fontSize: 9, opacity: 0.6 }}>◈</span>
      {env} environment — not production
      <span style={{ fontSize: 9, opacity: 0.6 }}>◈</span>
    </div>
  );
}

// --- header ------------------------------------------------------------------

function Header({
  liveCount, totalCount, env, view, onViewChange, canReset, onReset,
}: {
  liveCount: number;
  totalCount: number;
  env?: string | null;
  view: View;
  onViewChange: (v: View) => void;
  canReset: boolean;
  onReset: () => void;
}) {
  const envLink = env ? ENV_URLS[env.toLowerCase()] : ENV_URLS["prod"];

  return (
    <header style={{
      display: "flex", alignItems: "center", gap: 16,
      padding: "14px 20px",
      background: "var(--surface)",
      border: "1px solid var(--border)",
      borderRadius: 12,
    }}>
      {/* Wordmark */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        <div style={{
          width: 32, height: 32, borderRadius: 8,
          background: "var(--indigo-dim)",
          border: "1px solid rgba(120,100,220,0.3)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <span style={{ fontSize: 14, color: "var(--indigo-bright)" }}>◈</span>
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.08em", color: "var(--indigo-bright)" }}>
            JARVIS
          </div>
          <div style={{ fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.05em" }}>
            Project Dashboard
          </div>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: "flex", alignItems: "center", gap: 20, marginLeft: 12 }}>
        <Stat label="Projects" value={String(totalCount)} />
        <Stat label="Live" value={String(liveCount)} valueColor="var(--green)" />
      </div>

      {/* Right side */}
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
        {canReset && (
          <button
            onClick={onReset}
            title="Reset card order & collapsed sections"
            style={{
              fontSize: 11, color: "var(--text-dim)",
              background: "transparent", cursor: "pointer",
              letterSpacing: "0.04em",
              padding: "5px 10px",
              border: "1px solid var(--border)",
              borderRadius: 6,
              transition: "color 0.15s, border-color 0.15s",
            }}
            onMouseEnter={e => { e.currentTarget.style.color = "var(--text)"; e.currentTarget.style.borderColor = "var(--border-mid)"; }}
            onMouseLeave={e => { e.currentTarget.style.color = "var(--text-dim)"; e.currentTarget.style.borderColor = "var(--border)"; }}
          >
            ⟲ Layout
          </button>
        )}
        {envLink && (
          <a
            href={envLink.url}
            style={{
              fontSize: 11, color: "var(--text-dim)",
              textDecoration: "none", letterSpacing: "0.04em",
              padding: "5px 10px",
              border: "1px solid var(--border)",
              borderRadius: 6,
              transition: "color 0.15s, border-color 0.15s",
            }}
            onMouseEnter={e => { (e.target as HTMLElement).style.color = "var(--text)"; (e.target as HTMLElement).style.borderColor = "var(--border-mid)"; }}
            onMouseLeave={e => { (e.target as HTMLElement).style.color = "var(--text-dim)"; (e.target as HTMLElement).style.borderColor = "var(--border)"; }}
          >
            {envLink.label}
          </a>
        )}

        {(["projects", "health"] as View[]).map((v) => (
          <button
            key={v}
            onClick={() => onViewChange(v)}
            style={{
              padding: "5px 12px", borderRadius: 6, fontSize: 11,
              fontWeight: 600, letterSpacing: "0.05em",
              cursor: "pointer",
              transition: "all 0.15s",
              border: view === v ? "1px solid rgba(120,100,220,0.5)" : "1px solid var(--border)",
              background: view === v ? "var(--indigo-dim)" : "transparent",
              color: view === v ? "var(--indigo-bright)" : "var(--text-dim)",
            }}
          >
            {v.charAt(0).toUpperCase() + v.slice(1)}
          </button>
        ))}
      </div>
    </header>
  );
}

function Stat({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <span style={{ fontSize: 17, fontWeight: 700, color: valueColor ?? "var(--text)", letterSpacing: "-0.02em" }}>
        {value}
      </span>
      <span style={{ fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.05em", textTransform: "uppercase" }}>
        {label}
      </span>
    </div>
  );
}

// --- loading / empty states --------------------------------------------------

function LoadingState() {
  return (
    <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fill, minmax(270px, 1fr))" }}>
      {[...Array(6)].map((_, i) => (
        <div key={i} className="card" style={{
          height: 140, opacity: 0.4,
          background: "linear-gradient(90deg, var(--surface) 25%, var(--surface-2) 50%, var(--surface) 75%)",
          backgroundSize: "200% 100%",
          animation: `shimmer 1.5s ${i * 0.1}s ease-in-out infinite`,
        }} />
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div style={{ padding: "40px 0", textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
      No registry — run sync-registry.mjs
    </div>
  );
}

function NoMatches({ query }: { query: string }) {
  return (
    <div style={{ padding: "40px 0", textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
      No projects match “{query.trim()}”.
    </div>
  );
}

// --- controls bar (filter / sort / collapse-all) -----------------------------

function ControlsBar({
  filter, onFilter, sort, onSort, allCollapsed, onToggleAll, filtering, matchCount, totalCount,
}: {
  filter: string;
  onFilter: (v: string) => void;
  sort: SortMode;
  onSort: (s: SortMode) => void;
  allCollapsed: boolean;
  onToggleAll: () => void;
  filtering: boolean;
  matchCount: number;
  totalCount: number;
}) {
  return (
    <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      {/* Filter */}
      <div style={{ position: "relative", flex: "1 1 220px", maxWidth: 340 }}>
        <span style={{
          position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)",
          fontSize: 12, color: "var(--text-muted)", pointerEvents: "none",
        }}>⌕</span>
        <input
          value={filter}
          onChange={(e) => onFilter(e.target.value)}
          placeholder="Filter projects…"
          aria-label="Filter projects"
          style={{
            width: "100%", padding: "7px 26px", boxSizing: "border-box",
            background: "var(--surface)", border: "1px solid var(--border)",
            borderRadius: 8, color: "var(--text)", fontSize: 12, outline: "none",
            transition: "border-color 0.15s",
          }}
          onFocus={(e) => (e.currentTarget.style.borderColor = "var(--border-mid)")}
          onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
        />
        {filter && (
          <button
            onClick={() => onFilter("")}
            title="Clear filter"
            aria-label="Clear filter"
            style={{
              position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)",
              background: "none", border: "none", color: "var(--text-muted)",
              cursor: "pointer", fontSize: 15, lineHeight: 1, padding: "2px 4px",
            }}
          >×</button>
        )}
      </div>

      {filtering && (
        <span style={{ fontSize: 11, color: "var(--text-muted)", letterSpacing: "0.03em" }}>
          {matchCount} of {totalCount}
        </span>
      )}

      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
        <label style={{
          display: "flex", alignItems: "center", gap: 6,
          fontSize: 11, color: "var(--text-muted)", letterSpacing: "0.04em",
        }}>
          Sort
          <select
            value={sort}
            onChange={(e) => onSort(e.target.value as SortMode)}
            style={{
              background: "var(--surface)", color: "var(--text)",
              border: "1px solid var(--border)", borderRadius: 6,
              padding: "5px 8px", fontSize: 11, cursor: "pointer", outline: "none",
            }}
          >
            {SORT_MODES.map((m) => (
              <option key={m} value={m} style={{ background: "var(--surface)" }}>{SORT_LABEL[m]}</option>
            ))}
          </select>
        </label>

        <button
          onClick={onToggleAll}
          style={{
            fontSize: 11, color: "var(--text-dim)", background: "transparent",
            cursor: "pointer", letterSpacing: "0.04em", padding: "5px 10px",
            border: "1px solid var(--border)", borderRadius: 6,
            transition: "color 0.15s, border-color 0.15s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; e.currentTarget.style.borderColor = "var(--border-mid)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-dim)"; e.currentTarget.style.borderColor = "var(--border)"; }}
        >
          {allCollapsed ? "Expand all" : "Collapse all"}
        </button>
      </div>
    </div>
  );
}

// --- lane section ------------------------------------------------------------

function LaneSection({ lane, cards, collapsed, draggable, onToggleCollapse, onReorder, health, now }: {
  lane: Lane;
  cards: Card[];
  collapsed: boolean;
  draggable: boolean;
  onToggleCollapse: () => void;
  onReorder: (ids: string[]) => void;
  health: HealthMap;
  now: number;
}) {
  // Local id order drives rendering so a drag reorders instantly; it re-syncs from
  // props (the persisted order) whenever a drag isn't in progress.
  const [localIds, setLocalIds] = useState<string[]>(() => cards.map((c) => c.id));
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const idsRef = useRef(localIds);
  idsRef.current = localIds;
  const dragRef = useRef<string | null>(null); // active drag id (drives logic; state is for styling)
  const overRef = useRef<string | null>(null); // last card we reordered onto (dedupes re-entry)

  // Pointer-drag machinery. Mouse picks a card up on a small move; touch long-presses
  // to pick up, so a plain finger-swipe still scrolls the page.
  const gridRef = useRef<HTMLDivElement>(null);
  const activePointer = useRef<number | null>(null);
  const pressTimer = useRef<number | null>(null);
  const startPt = useRef({ x: 0, y: 0 });
  const winMoveUp = useRef<{ move: (e: PointerEvent) => void; up: (e: PointerEvent) => void } | null>(null);
  const preventTouch = useRef<((e: TouchEvent) => void) | null>(null);
  const scrollDir = useRef(0);
  const scrollRAF = useRef<number | null>(null);
  // Floating drag-preview ("ghost") that follows the pointer.
  const ghostRef = useRef<HTMLDivElement>(null);
  const grabOffset = useRef({ x: 0, y: 0 }); // pointer position within the grabbed card
  const ghostW = useRef(0);                  // grabbed card's width, so the ghost matches
  const lastPointer = useRef({ x: 0, y: 0 });

  function positionGhost() {
    if (ghostRef.current) {
      ghostRef.current.style.transform =
        `translate(${lastPointer.current.x - grabOffset.current.x}px, ${lastPointer.current.y - grabOffset.current.y}px)`;
    }
  }

  useEffect(() => {
    if (!draggingId) setLocalIds(cards.map((c) => c.id));
  }, [cards, draggingId]);

  // If the lane unmounts mid-gesture, drop any window listeners / timers.
  useEffect(() => () => teardownDrag(), []); // eslint-disable-line react-hooks/exhaustive-deps

  if (cards.length === 0) return null;

  const byId = new Map(cards.map((c) => [c.id, c]));
  const ordered = localIds.map((id) => byId.get(id)).filter(Boolean) as Card[];
  const ghostCard = draggingId ? byId.get(draggingId) : undefined;

  function startDrag(id: string) {
    dragRef.current = id;
    overRef.current = id;
    setDraggingId(id);
    setOverId(id);
    // Block the browser's own scroll for the duration of a touch drag.
    const pt = (e: TouchEvent) => e.preventDefault();
    preventTouch.current = pt;
    window.addEventListener("touchmove", pt, { passive: false });
  }

  // Move the dragged card to the target's slot — but only when the pointer crosses
  // onto a *new* card, so hovering within one card can't oscillate the order.
  function moveOver(targetId: string) {
    const dragId = dragRef.current;
    if (!dragId || dragId === targetId || overRef.current === targetId) return;
    overRef.current = targetId;
    setOverId(targetId);
    setLocalIds((prev) => {
      const cur = [...prev];
      const fi = cur.indexOf(dragId);
      const ti = cur.indexOf(targetId);
      if (fi < 0 || ti < 0) return prev;
      cur.splice(ti, 0, cur.splice(fi, 1)[0]);
      return cur;
    });
  }

  // Which card in *this* lane is under the pointer — by geometry, so it doesn't
  // depend on z-order/pointer-events. Returns the containing card, else the nearest.
  function cardAt(x: number, y: number): string | null {
    const els = gridRef.current?.querySelectorAll<HTMLElement>("[data-card-id]");
    if (!els) return null;
    let best: string | null = null;
    let bestDist = Infinity;
    for (const el of els) {
      const r = el.getBoundingClientRect();
      const id = el.getAttribute("data-card-id");
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return id;
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const d = Math.hypot(x - cx, y - cy);
      if (d < bestDist) { bestDist = d; best = id; }
    }
    return best;
  }

  // Scroll the page when a drag hovers near the top/bottom edge (for long lists on
  // small screens).
  function edgeAutoScroll(clientY: number) {
    const margin = 90;
    const h = window.innerHeight;
    scrollDir.current = clientY < margin ? -1 : clientY > h - margin ? 1 : 0;
    if (scrollDir.current !== 0 && scrollRAF.current == null) {
      const tick = () => {
        if (scrollDir.current === 0) { scrollRAF.current = null; return; }
        window.scrollBy(0, scrollDir.current * 12);
        scrollRAF.current = requestAnimationFrame(tick);
      };
      scrollRAF.current = requestAnimationFrame(tick);
    }
  }

  function teardownDrag() {
    if (pressTimer.current != null) { clearTimeout(pressTimer.current); pressTimer.current = null; }
    if (scrollRAF.current != null) { cancelAnimationFrame(scrollRAF.current); scrollRAF.current = null; }
    scrollDir.current = 0;
    if (winMoveUp.current) {
      window.removeEventListener("pointermove", winMoveUp.current.move);
      window.removeEventListener("pointerup", winMoveUp.current.up);
      window.removeEventListener("pointercancel", winMoveUp.current.up);
      winMoveUp.current = null;
    }
    if (preventTouch.current) {
      window.removeEventListener("touchmove", preventTouch.current);
      preventTouch.current = null;
    }
    activePointer.current = null;
  }

  function endDrag() {
    const wasDragging = dragRef.current != null;
    dragRef.current = null;
    overRef.current = null;
    teardownDrag();
    if (wasDragging) {
      setDraggingId(null);
      setOverId(null);
      onReorder(idsRef.current);
    }
  }

  // Whole card is the handle. Mouse picks up on a small move (so clicks/text still
  // work); touch long-presses to pick up (so a plain swipe scrolls). A grab that
  // starts on a link/button is ignored so those stay tappable.
  function onCardPointerDown(e: React.PointerEvent, id: string) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if ((e.target as HTMLElement).closest("a,button")) return;
    if (activePointer.current != null) return;
    activePointer.current = e.pointerId;
    startPt.current = { x: e.clientX, y: e.clientY };
    lastPointer.current = { x: e.clientX, y: e.clientY };
    // Remember where in the card we grabbed + its width, so the floating preview
    // sits under the cursor and matches the card's size.
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    grabOffset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    ghostW.current = rect.width;

    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== activePointer.current) return;
      lastPointer.current = { x: ev.clientX, y: ev.clientY };
      if (dragRef.current == null) {
        const dist = Math.hypot(ev.clientX - startPt.current.x, ev.clientY - startPt.current.y);
        if (ev.pointerType === "mouse") {
          if (dist > 5) startDrag(id);
        } else if (dist > 10) {
          teardownDrag(); // moved before the long-press fired → treat as a scroll
        }
        return;
      }
      ev.preventDefault();
      positionGhost();
      const tid = cardAt(ev.clientX, ev.clientY);
      if (tid) moveOver(tid);
      edgeAutoScroll(ev.clientY);
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== activePointer.current) return;
      endDrag();
    };

    winMoveUp.current = { move, up };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);

    if (e.pointerType !== "mouse") {
      pressTimer.current = window.setTimeout(() => { pressTimer.current = null; startDrag(id); }, 180);
    }
  }

  return (
    <section>
      <button
        className="lane-toggle"
        data-collapsed={collapsed}
        onClick={onToggleCollapse}
        aria-expanded={!collapsed}
      >
        <span className="lane-chevron" style={{ fontSize: 9, color: LANE_COLOR[lane], width: 8 }}>▾</span>
        <span style={{
          display: "inline-block",
          width: 7, height: 7, borderRadius: "50%",
          background: LANE_COLOR[lane],
          boxShadow: `0 0 6px ${LANE_COLOR[lane]}`,
          flexShrink: 0,
        }} />
        <span style={{
          fontSize: 11, fontWeight: 700,
          letterSpacing: "0.12em", textTransform: "uppercase",
          color: LANE_COLOR[lane],
        }}>
          {LANE_LABEL[lane]}
        </span>
        <span style={{
          fontSize: 10, color: "var(--text-muted)",
          background: LANE_DOT_BG[lane],
          padding: "1px 7px", borderRadius: 10,
          fontWeight: 600,
        }}>
          {cards.length}
        </span>
        <span style={{ flex: 1, height: 1, background: "var(--border)", marginLeft: 4 }} />
      </button>

      {!collapsed && (
        <div ref={gridRef} style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fill, minmax(270px, 1fr))" }}>
          {ordered.map((card) =>
            draggable ? (
              <DraggableCard
                key={card.id}
                card={card}
                health={health}
                now={now}
                dragging={draggingId === card.id}
                dropTarget={overId === card.id && draggingId !== card.id}
                onPointerDown={(e) => onCardPointerDown(e, card.id)}
              />
            ) : (
              <ProjectCard key={card.id} card={card} health={health} now={now} />
            ),
          )}
        </div>
      )}

      {ghostCard && (
        <div
          ref={ghostRef}
          aria-hidden
          className="drag-ghost"
          style={{
            position: "fixed", top: 0, left: 0, width: ghostW.current, zIndex: 1000,
            pointerEvents: "none", opacity: 0.95,
            transform: `translate(${lastPointer.current.x - grabOffset.current.x}px, ${lastPointer.current.y - grabOffset.current.y}px)`,
          }}
        >
          <div style={{
            transform: "scale(1.03) rotate(0.6deg)",
            boxShadow: "0 16px 38px rgba(0,0,0,0.55)",
            borderRadius: 10,
          }}>
            <ProjectCard card={ghostCard} health={health} now={now} />
          </div>
        </div>
      )}
    </section>
  );
}

// A ProjectCard made draggable via Pointer Events (works for mouse, touch and pen)
// for manual reordering. The whole card is the handle; the drag controller in
// LaneSection ignores grabs that begin on the action links so those stay tappable.
// `touch-action: pan-y` lets a plain vertical swipe scroll the page normally — the
// controller only takes over once a touch has long-pressed to pick the card up.
function DraggableCard({
  card, health, now, dragging, dropTarget, onPointerDown,
}: {
  card: Card;
  health: HealthMap;
  now: number;
  dragging: boolean;
  dropTarget: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  return (
    <div
      className={`drag-cell${dragging ? " dragging" : ""}${dropTarget ? " drop-target" : ""}`}
      data-card-id={card.id}
      onPointerDown={onPointerDown}
      style={{ cursor: "grab", touchAction: "pan-y" }}
    >
      <ProjectCard card={card} health={health} now={now} />
    </div>
  );
}

// --- project card ------------------------------------------------------------

function ProjectCard({ card, health, now }: {
  card: Card;
  health: HealthMap;
  now: number;
}) {
  const h = health[card.id];
  const isOnline = h?.state === "online";
  const isDown = h && h.state !== "online";

  return (
    <div
      className="card fade-in"
      style={{
        display: "flex", flexDirection: "column",
        padding: "14px 16px",
        gap: 10,
        borderColor: isDown ? "rgba(220,60,60,0.25)" : undefined,
      }}
    >
      {/* Top row: name + health */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 13, fontWeight: 700,
            color: "var(--text)",
            letterSpacing: "0.01em",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {card.name}
          </div>
        </div>

        {/* Health badge */}
        {h ? (
          <span style={{
            flexShrink: 0, fontSize: 10, fontWeight: 600,
            padding: "2px 7px", borderRadius: 5,
            background: isOnline ? "var(--green-dim)" : "var(--red-dim)",
            color: isOnline ? "var(--green)" : "var(--red)",
            border: `1px solid ${isOnline ? "rgba(61,204,122,0.2)" : "rgba(220,60,60,0.2)"}`,
            letterSpacing: "0.04em",
          }}
            title={h.ms != null ? `${h.ms}ms` : undefined}
          >
            {isOnline ? "● live" : "○ down"}
          </span>
        ) : card.liveUrl ? (
          <span style={{ fontSize: 10, color: "var(--text-muted)", padding: "2px 0" }}>···</span>
        ) : null}
      </div>

      {/* Description */}
      {card.description && (
        <p style={{
          margin: 0, fontSize: 11.5,
          color: "var(--text-dim)", lineHeight: 1.55,
          display: "-webkit-box",
          WebkitBoxOrient: "vertical",
          WebkitLineClamp: 2,
          overflow: "hidden",
        }}>
          {card.description}
        </p>
      )}

      {/* Meta row */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10.5, marginTop: "auto" }}>
        {card.version && (
          <span style={{
            color: "var(--indigo-bright)",
            background: "var(--indigo-dim)",
            padding: "1px 6px", borderRadius: 4,
            fontWeight: 600, letterSpacing: "0.03em",
          }}>
            {card.version}
          </span>
        )}
        {card.lastCommit && now > 0 && (
          <span style={{ color: "var(--text-muted)" }}>{timeAgo(card.lastCommit)} ago</span>
        )}
        {!!card.backlog && (
          <>
            <span style={{ color: "var(--border-mid)" }}>·</span>
            <span style={{ color: "var(--amber)" }}>{card.backlog} backlog</span>
          </>
        )}
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: 7, paddingTop: 2 }}>
        {card.liveUrl && (
          <a
            href={card.liveUrl}
            target="_blank"
            rel="noreferrer"
            draggable={false}
            style={{
              fontSize: 11, fontWeight: 600,
              padding: "5px 12px", borderRadius: 6,
              background: "var(--indigo-dim)",
              border: "1px solid rgba(120,100,220,0.3)",
              color: "var(--indigo-bright)",
              textDecoration: "none",
              letterSpacing: "0.04em",
              cursor: "pointer",
              transition: "background 0.15s",
            }}
            onMouseEnter={e => (e.currentTarget.style.background = "rgba(120,100,220,0.25)")}
            onMouseLeave={e => (e.currentTarget.style.background = "var(--indigo-dim)")}
          >
            Launch ↗
          </a>
        )}
        {card.repoUrl && (
          <a
            href={card.repoUrl}
            target="_blank"
            rel="noreferrer"
            draggable={false}
            style={{
              fontSize: 11, fontWeight: 500,
              padding: "5px 12px", borderRadius: 6,
              background: "transparent",
              border: "1px solid var(--border)",
              color: "var(--text-dim)",
              textDecoration: "none",
              letterSpacing: "0.04em",
              cursor: "pointer",
              transition: "border-color 0.15s, color 0.15s",
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--border-mid)"; e.currentTarget.style.color = "var(--text)"; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.color = "var(--text-dim)"; }}
          >
            GitHub
          </a>
        )}
      </div>
    </div>
  );
}

// --- health tab --------------------------------------------------------------

function HealthTab() {
  const [data, setData] = useState<{
    status: SystemHealth | null;
    logs: string[];
    host: HostInfo;
    upstreamError?: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/system-health", { cache: "no-store" });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "upstream error");
      setData({
        status: json.status ?? null,
        logs: json.logs ?? [],
        host: json.host,
        upstreamError: json.upstreamError,
      });
      setError(null);
      setLastUpdated(new Date());
    } catch (e) {
      setError(String(e));
    }
    timerRef.current = setTimeout(load, 30000);
  }, []);

  useEffect(() => {
    load();
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [load]);

  if (error) {
    return (
      <div className="card" style={{ padding: "16px 20px", color: "var(--red)", fontSize: 13 }}>
        Jarvis unreachable — {error}
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ color: "var(--text-muted)", fontSize: 13, padding: "40px 0", textAlign: "center" }}>
        Loading health data…
      </div>
    );
  }

  const { status: s, logs, host, upstreamError } = data;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
        {s ? (
          <MetricCard title="Disk" pct={s.disk.pct} label={`${s.disk.pct}% — ${s.disk.free_gb} GB free`} ok={s.disk.ok} warnAt={80} critAt={90} />
        ) : (
          <UnavailableCard title="Disk" />
        )}
        <MetricCard
          title="Memory"
          pct={host.mem.pct}
          label={`${host.mem.pct}% — ${host.mem.used_gb} / ${host.mem.total_gb} GB`}
          ok={host.mem.ok}
          warnAt={85}
          critAt={95}
        />
        <UpdatesCard updates={host.updates} trackedOutdated={host.platform.filter((p) => p.outdated).length} />
        {s ? <DotsCard title="Services" items={s.services} /> : <UnavailableCard title="Services" />}
        {s ? <DotsCard title="Containers" items={s.containers} /> : <UnavailableCard title="Containers" />}
      </div>

      <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", alignItems: "start" }}>
        <SpecsCard specs={host.specs} totalRam={host.mem.total_gb} />
        <PlatformCard items={host.platform} />
      </div>

      {upstreamError && (
        <div className="card" style={{
          padding: "10px 16px", fontSize: 11.5, color: "var(--amber)",
          borderColor: "rgba(224,136,32,0.25)", letterSpacing: "0.02em",
        }}>
          Jarvis core unreachable — showing host metrics only (services, disk &amp; log unavailable).
        </div>
      )}

      {/* Log */}
      <div className="card" style={{ overflow: "hidden" }}>
        <div style={{
          display: "flex", alignItems: "center",
          padding: "10px 16px",
          borderBottom: "1px solid var(--border)",
          fontSize: 11, fontWeight: 600, color: "var(--text-dim)",
          letterSpacing: "0.06em", textTransform: "uppercase",
        }}>
          <span>Health Log</span>
          {lastUpdated && (
            <span style={{ marginLeft: "auto", fontWeight: 400, textTransform: "none", letterSpacing: 0, color: "var(--text-muted)" }}>
              updated {lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
        </div>
        <div
          className="log-mono"
          style={{ maxHeight: 340, overflowY: "auto", padding: "12px 16px", color: "var(--text-dim)" }}
        >
          {logs.length === 0 ? (
            <span style={{ opacity: 0.4 }}>No log entries yet.</span>
          ) : (
            logs.map((line, i) => {
              const isWarn = line.includes("WARN") || line.includes("ISSUE");
              const isCrit = line.startsWith("  ISSUES");
              return (
                <div key={i} style={{
                  color: isCrit ? "var(--red)" : isWarn ? "var(--amber)" : undefined,
                  whiteSpace: "pre-wrap", wordBreak: "break-all",
                }}>
                  {line}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

function MetricCard({ title, pct, label, ok, warnAt, critAt }: {
  title: string; pct: number; label: string; ok: boolean; warnAt: number; critAt: number;
}) {
  const barColor = pct >= critAt ? "var(--red)" : pct >= warnAt ? "var(--amber)" : "var(--green)";
  return (
    <div className="card" style={{
      padding: "14px 16px",
      borderColor: !ok ? "rgba(220,60,60,0.25)" : undefined,
    }}>
      <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-muted)", marginBottom: 8 }}>
        {title}
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, color: ok ? "var(--text)" : "var(--red)", marginBottom: 10, letterSpacing: "-0.02em" }}>
        {label}
      </div>
      <div style={{ height: 3, borderRadius: 2, background: "var(--surface-2)", overflow: "hidden" }}>
        <div style={{
          height: "100%", borderRadius: 2,
          width: `${Math.min(pct, 100)}%`,
          background: barColor,
          transition: "width 0.5s ease",
        }} />
      </div>
    </div>
  );
}

function DotsCard({ title, items }: { title: string; items: Record<string, boolean> }) {
  const hasIssue = Object.values(items).some((ok) => !ok);
  return (
    <div className="card" style={{
      padding: "14px 16px",
      borderColor: hasIssue ? "rgba(220,60,60,0.25)" : undefined,
    }}>
      <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-muted)", marginBottom: 10 }}>
        {title}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px" }}>
        {Object.entries(items).map(([name, ok]) => (
          <div key={name} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--text-dim)" }}>
            <span style={{
              display: "inline-block", width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
              background: ok ? "var(--green)" : "var(--red)",
              boxShadow: ok ? "0 0 4px var(--green)" : "0 0 4px var(--red)",
            }} />
            {name}
          </div>
        ))}
        {Object.keys(items).length === 0 && (
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>none</span>
        )}
      </div>
    </div>
  );
}

// --- specs card --------------------------------------------------------------

function SpecsCard({ specs, totalRam }: { specs: HostInfo["specs"]; totalRam: number }) {
  const items: [string, string][] = [
    ["CPU", specs.cpu],
    ["Cores", String(specs.cores)],
    ["iGPU", specs.gpu ?? "—"],
    ["Arch", specs.arch],
    ["Memory", `${totalRam} GB`],
  ];
  return (
    <div className="card" style={{ padding: "14px 16px" }}>
      <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-muted)", marginBottom: 12 }}>
        Host / Hardware
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "14px 30px" }}>
        {items.map(([label, value]) => (
          <div key={label} style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
            <span style={{ fontSize: 9.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-muted)" }}>
              {label}
            </span>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", letterSpacing: "0.01em" }}>
              {value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const PLATFORM_GROUP_ORDER = ["Runtimes", "Containers", "Web/TLS", "Network", "System"];

function PlatformCard({ items }: { items: PlatformItem[] }) {
  const anyOutdated = items.some((i) => i.outdated);
  const groups = PLATFORM_GROUP_ORDER
    .map((g) => [g, items.filter((i) => i.group === g)] as const)
    .filter(([, list]) => list.length > 0);

  return (
    <div className="card" style={{ padding: "14px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
        <span style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-muted)" }}>
          Platform
        </span>
        {anyOutdated && (
          <span style={{ marginLeft: "auto", fontSize: 9.5, fontWeight: 600, color: "var(--amber)", letterSpacing: "0.04em" }}>
            ▲ update available
          </span>
        )}
      </div>

      {groups.length === 0 ? (
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>unavailable</span>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
          {groups.map(([group, list]) => (
            <div key={group}>
              <div style={{ fontSize: 9, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.11em", color: "var(--text-muted)", opacity: 0.75, marginBottom: 7 }}>
                {group}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "12px 26px" }}>
                {list.map((it) => <PlatformItemView key={it.name} it={it} />)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PlatformItemView({ it }: { it: PlatformItem }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
      <span style={{ fontSize: 9.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-muted)" }}>
        {it.name}
      </span>
      <span
        title={it.outdated && it.latest ? `update available: ${it.latest}` : undefined}
        style={{
          display: "flex", alignItems: "center", gap: 5,
          fontSize: 13, fontWeight: 600, letterSpacing: "0.01em",
          fontVariantNumeric: "tabular-nums",
          color: it.outdated ? "var(--amber)" : "var(--text)",
        }}
      >
        {it.version}
        {it.outdated && (
          <span style={{
            fontSize: 9, fontWeight: 700, color: "var(--amber)",
            background: "rgba(224,136,32,0.12)",
            border: "1px solid rgba(224,136,32,0.3)",
            borderRadius: 4, padding: "0 4px",
            letterSpacing: "0.02em", whiteSpace: "nowrap",
          }}>
            ▲{it.latest ? ` ${it.latest}` : ""}
          </span>
        )}
      </span>
    </div>
  );
}

function UpdatesCard({ updates, trackedOutdated }: { updates: UpdateInfo | null; trackedOutdated: number }) {
  if (!updates) {
    return (
      <div className="card" style={{ padding: "14px 16px" }}>
        <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-muted)", marginBottom: 8 }}>
          Updates
        </div>
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>apt unavailable</div>
      </div>
    );
  }

  const { upgradable, security, reboot } = updates;
  const crit = security > 0 || reboot;
  const warn = upgradable > 0;
  const color = crit ? "var(--red)" : warn ? "var(--amber)" : "var(--green)";
  const border = crit ? "rgba(220,60,60,0.25)" : warn ? "rgba(224,136,32,0.25)" : undefined;

  const parts: { text: string; crit?: boolean }[] = [];
  if (security > 0) parts.push({ text: `${security} security`, crit: true });
  if (reboot) parts.push({ text: "reboot required", crit: true });
  if (parts.length === 0) parts.push({ text: upgradable > 0 ? "no security updates" : "system current" });

  return (
    <div className="card" style={{ padding: "14px 16px", borderColor: border }}>
      <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-muted)", marginBottom: 8 }}>
        Updates
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, color, marginBottom: 8, letterSpacing: "-0.02em" }}>
        {upgradable === 0 ? "Up to date" : `${upgradable} available`}
      </div>
      {upgradable > 0 && (
        <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 6 }}>
          <span style={{ color: trackedOutdated > 0 ? "var(--amber)" : undefined }}>{trackedOutdated} tracked</span>
          <span style={{ color: "var(--border-mid)", margin: "0 6px" }}>·</span>
          <span>{Math.max(upgradable - trackedOutdated, 0)} Ubuntu</span>
        </div>
      )}
      <div style={{ fontSize: 11, color: "var(--text-dim)", display: "flex", flexWrap: "wrap", gap: "2px 8px" }}>
        {parts.map((p, i) => (
          <span key={i} style={{ color: p.crit ? "var(--red)" : undefined }}>
            {i > 0 && <span style={{ color: "var(--border-mid)", marginRight: 8 }}>·</span>}
            {p.text}
          </span>
        ))}
      </div>
    </div>
  );
}

function UnavailableCard({ title }: { title: string }) {
  return (
    <div className="card" style={{ padding: "14px 16px", opacity: 0.55 }}>
      <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-muted)", marginBottom: 8 }}>
        {title}
      </div>
      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Jarvis core offline</div>
    </div>
  );
}

// --- status bar --------------------------------------------------------------

function StatusBar({ totalCount, liveCount, now }: {
  totalCount: number; liveCount: number; now: number;
}) {
  return (
    <footer style={{
      marginTop: 28,
      display: "flex", alignItems: "center", gap: 0,
      padding: "10px 16px",
      background: "var(--surface)",
      border: "1px solid var(--border)",
      borderRadius: 8,
      fontSize: 10.5, color: "var(--text-muted)",
      letterSpacing: "0.04em",
    }}>
      <span>Auto-refresh 8s</span>
      <Sep />
      <span>{totalCount} projects</span>
      <Sep />
      <span style={{ color: "var(--green)" }}>{liveCount} live</span>
      <span style={{ marginLeft: "auto" }}>
        {now
          ? new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
          : "--:--"}
      </span>
    </footer>
  );
}

function Sep() {
  return <span style={{ margin: "0 12px", opacity: 0.25 }}>|</span>;
}
