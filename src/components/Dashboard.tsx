"use client";

import { useCallback, useEffect, useState } from "react";
import type { Lane } from "@/lib/registry";

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

// --- constants ---------------------------------------------------------------

const LANE_ORDER: Lane[] = ["live", "in_progress", "mothballed"];

const LANE_LABEL: Record<Lane, string> = {
  live: "LIVE",
  in_progress: "IN PROGRESS",
  mothballed: "MOTHBALLED",
};

const LANE_COLOR: Record<Lane, string> = {
  live: "var(--dos-green)",
  in_progress: "var(--dos-cyan-bright)",
  mothballed: "var(--dos-amber)",
};

// Category display order within a lane (lower = earlier).
const CATEGORY_ORDER: Record<string, number> = {
  "jarvis-tools": 0,
  games: 1,
  apps: 2,
  standalone: 3,
};

// --- helpers -----------------------------------------------------------------

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return `${Math.round(d / 30)}mo ago`;
}

function sortCards(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => {
    const ao = CATEGORY_ORDER[a.category ?? ""] ?? 99;
    const bo = CATEGORY_ORDER[b.category ?? ""] ?? 99;
    return ao - bo || a.name.localeCompare(b.name);
  });
}

// --- main --------------------------------------------------------------------

export default function Dashboard({ env }: { env?: string | null }) {
  const [cards, setCards] = useState<Card[]>([]);
  const [health, setHealth] = useState<HealthMap>({});
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(0);

  const refreshCards = useCallback(async () => {
    try {
      const res = await fetch("/api/registry", { cache: "no-store" });
      const data = await res.json();
      setCards(data.cards ?? []);
    } catch {
      /* keep last */
    } finally {
      setLoading(false);
      setNow(Date.now());
    }
  }, []);

  const refreshHealth = useCallback(async () => {
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      const data = await res.json();
      setHealth(data.apps ?? {});
    } catch {
      /* keep last */
    }
  }, []);

  useEffect(() => {
    setNow(Date.now());
    refreshCards();
    refreshHealth();
    const t = setInterval(() => {
      refreshCards();
      refreshHealth();
    }, 8000);
    return () => clearInterval(t);
  }, [refreshCards, refreshHealth]);

  const byLane: Record<Lane, Card[]> = { live: [], in_progress: [], mothballed: [] };
  for (const card of cards) {
    (byLane[card.lane] ?? byLane.in_progress).push(card);
  }

  const liveCount = byLane.live.length;
  const totalCount = cards.length;

  return (
    <div className="crt min-h-screen">
      {env && <EnvBanner env={env} />}
      <div className="px-3 py-4 sm:px-6 sm:py-6">
        <div className="mx-auto max-w-[1600px]">
          <Header liveCount={liveCount} totalCount={totalCount} />

          <main className="mt-4 grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {loading ? (
              <p className="col-span-3 px-1 text-[var(--dos-gray)]">
                C:\JARVIS&gt; loading<span className="cursor" />
              </p>
            ) : cards.length === 0 ? (
              <p className="col-span-3 px-1 text-[var(--dos-gray)]">
                C:\JARVIS&gt; no registry — run sync-registry.mjs
              </p>
            ) : (
              LANE_ORDER.map((lane) => (
                <LaneSection
                  key={lane}
                  lane={lane}
                  cards={sortCards(byLane[lane])}
                  health={health}
                  now={now}
                />
              ))
            )}
          </main>

          <StatusBar totalCount={totalCount} liveCount={liveCount} now={now} />
        </div>
      </div>
    </div>
  );
}

// --- environment banner ------------------------------------------------------

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

function Header({ liveCount, totalCount }: { liveCount: number; totalCount: number }) {
  return (
    <header className="dos-box">
      <div className="dos-bar flex items-center gap-2 px-3 py-1 text-sm font-bold tracking-wider">
        <span>▓▒░</span>
        <span>JARVIS.SYS — PROJECT CONTROL</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-3 py-2 text-sm">
        <span className="glow font-bold text-[var(--dos-cyan-bright)]">
          ████ JARVIS<span className="cursor" />
        </span>
        <span className="text-[var(--dos-gray)]">
          PROJECTS:<b className="text-[var(--dos-white)]"> {totalCount}</b>
        </span>
        <span className="text-[var(--dos-gray)]">
          LIVE:<b style={{ color: "var(--dos-green)" }}> {liveCount}</b>
        </span>
      </div>
    </header>
  );
}

// --- lane section ------------------------------------------------------------

function LaneSection({
  lane,
  cards,
  health,
  now,
}: {
  lane: Lane;
  cards: Card[];
  health: HealthMap;
  now: number;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div
        className="dos-bar flex items-center gap-2 px-3 py-1 text-sm font-bold tracking-wider"
        style={{ background: LANE_COLOR[lane] }}
      >
        <span>■ {LANE_LABEL[lane]}</span>
        <span className="ml-auto font-normal opacity-80">{cards.length}</span>
      </div>

      {cards.length === 0 ? (
        <p className="py-3 text-center text-sm text-[var(--dos-gray)]">— empty —</p>
      ) : (
        cards.map((card) => (
          <ProjectCard key={card.id} card={card} health={health} now={now} />
        ))
      )}
    </section>
  );
}

// --- project card ------------------------------------------------------------

function ProjectCard({
  card,
  health,
  now,
}: {
  card: Card;
  health: HealthMap;
  now: number;
}) {
  const h = health[card.id];

  return (
    <div className="dos-box">
      {/* Title bar */}
      <div className="dos-bar flex items-center gap-2 px-3 py-1">
        <span className="glow min-w-0 flex-1 truncate font-bold">{card.name}</span>
        {h ? (
          <span
            className="shrink-0 text-xs font-bold tracking-wide"
            title={h.ms != null ? `${h.ms}ms` : undefined}
            style={{ color: h.state === "online" ? "var(--dos-green)" : "var(--dos-red)" }}
          >
            {h.state === "online" ? "● LIVE" : "○ DOWN"}
          </span>
        ) : card.liveUrl ? (
          <span className="shrink-0 text-[10px] uppercase tracking-wider opacity-60">···</span>
        ) : null}
      </div>

      {/* Body */}
      <div className="flex flex-col gap-2 px-3 py-2">
        {card.description && (
          <p
            className="text-xs leading-relaxed text-[var(--dos-gray)]"
            style={{
              display: "-webkit-box",
              WebkitBoxOrient: "vertical",
              WebkitLineClamp: 2,
              overflow: "hidden",
            }}
          >
            {card.description}
          </p>
        )}

        <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px]">
          {card.version && (
            <span className="text-[var(--dos-cyan)]">{card.version}</span>
          )}
          {card.lastCommit && now > 0 && (
            <span className="text-[var(--dos-gray)]">{timeAgo(card.lastCommit)}</span>
          )}
          {!!card.backlog && (
            <span style={{ color: "var(--dos-amber)" }}>{card.backlog} backlog</span>
          )}
        </div>

        <div className="flex items-center gap-2 pt-0.5">
          {card.liveUrl && (
            <a
              href={card.liveUrl}
              target="_blank"
              rel="noreferrer"
              className="dos-bar px-2 py-0.5 text-xs font-bold hover:opacity-80"
            >
              LAUNCH ▶
            </a>
          )}
          {card.repoUrl && (
            <a
              href={card.repoUrl}
              target="_blank"
              rel="noreferrer"
              className="px-2 py-0.5 text-xs text-[var(--dos-cyan)] hover:text-[var(--dos-cyan-bright)]"
              style={{ border: "1px solid var(--dos-cyan)" }}
            >
              GITHUB ↗
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

// --- status bar --------------------------------------------------------------

function StatusBar({
  totalCount,
  liveCount,
  now,
}: {
  totalCount: number;
  liveCount: number;
  now: number;
}) {
  return (
    <footer className="dos-bar mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-1 text-xs font-bold tracking-wide">
      <span>AUTO-REFRESH 8s</span>
      <span>{totalCount} PROJECTS</span>
      <span style={{ color: "var(--dos-green)" }}>{liveCount} LIVE</span>
      <span className="ml-auto">
        {now
          ? new Date(now).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })
          : "--:--"}
      </span>
    </footer>
  );
}
