"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Lane } from "@/lib/registry";
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

interface HostInfo {
  mem: { pct: number; used_gb: number; total_gb: number; ok: boolean };
  specs: { cpu: string; cores: number; arch: string; gpu: string | null };
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
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d`;
  return `${Math.round(d / 30)}mo`;
}

function sortCards(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => {
    const ao = CATEGORY_ORDER[a.category ?? ""] ?? 99;
    const bo = CATEGORY_ORDER[b.category ?? ""] ?? 99;
    return ao - bo || a.name.localeCompare(b.name);
  });
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

  const byLane: Record<Lane, Card[]> = { live: [], in_progress: [], mothballed: [] };
  for (const card of cards) {
    (byLane[card.lane] ?? byLane.in_progress).push(card);
  }

  const liveCount = byLane.live.length;
  const totalCount = cards.length;

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
        />

        <main style={{ marginTop: 28, display: "flex", flexDirection: "column", gap: 32 }}>
          {view === "health" ? (
            <HealthTab />
          ) : loading ? (
            <LoadingState />
          ) : cards.length === 0 ? (
            <EmptyState />
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
  liveCount, totalCount, env, view, onViewChange,
}: {
  liveCount: number;
  totalCount: number;
  env?: string | null;
  view: View;
  onViewChange: (v: View) => void;
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

// --- lane section ------------------------------------------------------------

function LaneSection({ lane, cards, health, now }: {
  lane: Lane;
  cards: Card[];
  health: HealthMap;
  now: number;
}) {
  if (cards.length === 0) return null;

  return (
    <section>
      {/* Lane header */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        marginBottom: 14,
      }}>
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
        <div style={{ flex: 1, height: 1, background: "var(--border)", marginLeft: 4 }} />
      </div>

      <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fill, minmax(270px, 1fr))" }}>
        {cards.map((card) => (
          <ProjectCard key={card.id} card={card} health={health} now={now} />
        ))}
      </div>
    </section>
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
            style={{
              fontSize: 11, fontWeight: 600,
              padding: "5px 12px", borderRadius: 6,
              background: "var(--indigo-dim)",
              border: "1px solid rgba(120,100,220,0.3)",
              color: "var(--indigo-bright)",
              textDecoration: "none",
              letterSpacing: "0.04em",
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
            style={{
              fontSize: 11, fontWeight: 500,
              padding: "5px 12px", borderRadius: 6,
              background: "transparent",
              border: "1px solid var(--border)",
              color: "var(--text-dim)",
              textDecoration: "none",
              letterSpacing: "0.04em",
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
        {s ? <DotsCard title="Services" items={s.services} /> : <UnavailableCard title="Services" />}
        {s ? <DotsCard title="Docker" items={s.containers} /> : <UnavailableCard title="Docker" />}
      </div>

      <SpecsCard specs={host.specs} totalRam={host.mem.total_gb} />

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
