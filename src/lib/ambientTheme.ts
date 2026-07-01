// Ambient time-of-day theme engine.
// Full light/dark/golden cycle across the day.
//
// Schedule:
//   Midnight–6am  : dark mode
//   6am–noon      : fade dark → light
//   Noon          : full light mode
//   Noon–4pm      : fade light → pre-golden
//   4pm–8pm       : golden hour glow
//   8pm–midnight  : fade golden → dark

interface Stop {
  h:          number;
  base:       string;
  surface:    string;
  surface2:   string;
  border:     string;
  borderMid:  string;
  text:       string;
  textDim:    string;
  textMuted:  string;
  accent:     string;
  accentMid:  string;
  accentDim:  string;
  sky:        string;
}

// ── palette stops ─────────────────────────────────────────────────────────────

const DARK: Omit<Stop, "h"> = {
  base:      "#07070f",
  surface:   "#0e0e1c",
  surface2:  "#141426",
  border:    "rgba(255,255,255,0.06)",
  borderMid: "rgba(255,255,255,0.10)",
  text:      "rgba(255,255,255,0.55)",
  textDim:   "rgba(255,255,255,0.25)",
  textMuted: "rgba(255,255,255,0.14)",
  accent:    "#6050c8",
  accentMid: "#4838a8",
  accentDim: "rgba(70,55,160,0.14)",
  sky:       "rgba(14,8,48,0.28)",
};

const LIGHT: Omit<Stop, "h"> = {
  base:      "#eeeef8",
  surface:   "#ffffff",
  surface2:  "#f4f4fc",
  border:    "rgba(50,30,140,0.09)",
  borderMid: "rgba(50,30,140,0.16)",
  text:      "rgba(12,10,36,0.88)",
  textDim:   "rgba(12,10,36,0.46)",
  textMuted: "rgba(12,10,36,0.28)",
  accent:    "#4830cc",
  accentMid: "#3620b0",
  accentDim: "rgba(68,48,200,0.12)",
  sky:       "rgba(80,55,200,0.06)",
};

const GOLDEN_PEAK: Omit<Stop, "h"> = {
  base:      "#120a03",
  surface:   "#1e1408",
  surface2:  "#27190a",
  border:    "rgba(240,170,30,0.14)",
  borderMid: "rgba(240,170,30,0.24)",
  text:      "rgba(255,235,185,0.90)",
  textDim:   "rgba(255,215,140,0.48)",
  textMuted: "rgba(255,195,100,0.30)",
  accent:    "#f0b828",
  accentMid: "#c89010",
  accentDim: "rgba(228,162,20,0.20)",
  sky:       "rgba(215,140,8,0.22)",
};

const GOLDEN_FADE: Omit<Stop, "h"> = {
  // 8pm — golden dissolving back to dark
  base:      "#0c0907",
  surface:   "#151210",
  surface2:  "#1c1916",
  border:    "rgba(200,140,40,0.09)",
  borderMid: "rgba(200,140,40,0.14)",
  text:      "rgba(255,245,220,0.65)",
  textDim:   "rgba(255,230,180,0.30)",
  textMuted: "rgba(255,210,140,0.18)",
  accent:    "#9060b0",
  accentMid: "#6840a8",
  accentDim: "rgba(120,60,160,0.15)",
  sky:       "rgba(90,45,110,0.18)",
};

const STOPS: Stop[] = [
  { h:  0, ...DARK },
  { h:  6, ...DARK },        // dark holds until dawn
  { h: 12, ...LIGHT },       // full light at noon
  { h: 16, ...{             // pre-golden — warm neutral bridge
    base:      "#1a1208",
    surface:   "#261a0c",
    surface2:  "#301f0e",
    border:    "rgba(230,165,40,0.11)",
    borderMid: "rgba(230,165,40,0.18)",
    text:      "rgba(255,230,175,0.82)",
    textDim:   "rgba(255,210,130,0.42)",
    textMuted: "rgba(255,190,90,0.26)",
    accent:    "#e8a828",
    accentMid: "#c08010",
    accentDim: "rgba(212,148,20,0.18)",
    sky:       "rgba(195,128,10,0.16)",
  }},
  { h: 18, ...GOLDEN_PEAK }, // peak golden hour
  { h: 20, ...GOLDEN_FADE }, // fading back to dark
  { h: 24, ...DARK },
];

// ── interpolation ─────────────────────────────────────────────────────────────

function hexLerp(a: string, b: string, t: number): string {
  const parse = (h: string) => {
    const x = parseInt(h.replace("#", ""), 16);
    return [(x >> 16) & 255, (x >> 8) & 255, x & 255];
  };
  const lerp = (x: number, y: number) => Math.round(x + (y - x) * t);
  const [ar, ag, ab] = parse(a);
  const [br, bg, bb] = parse(b);
  return `#${[lerp(ar, br), lerp(ag, bg), lerp(ab, bb)].map(v => v.toString(16).padStart(2, "0")).join("")}`;
}

function rgbaLerp(a: string, b: string, t: number): string {
  const parse = (s: string) => s.match(/[\d.]+/g)!.map(Number) as [number, number, number, number];
  const lerp = (x: number, y: number) => x + (y - x) * t;
  const [ar, ag, ab, aa] = parse(a);
  const [br, bg, bb, ba] = parse(b);
  return `rgba(${Math.round(lerp(ar, br))},${Math.round(lerp(ag, bg))},${Math.round(lerp(ab, bb))},${lerp(aa, ba).toFixed(2)})`;
}

function isRgba(s: string) { return s.startsWith("rgba") || s.startsWith("rgb"); }

function lerp(a: string, b: string, t: number): string {
  return isRgba(a) ? rgbaLerp(a, b, t) : hexLerp(a, b, t);
}

// ── public API ────────────────────────────────────────────────────────────────

export function computePalette(date: Date = new Date()): Stop & { hourFrac: number } {
  const hourFrac = date.getHours() + date.getMinutes() / 60;

  let lo = STOPS[STOPS.length - 2];
  let hi = STOPS[STOPS.length - 1];
  for (let i = 0; i < STOPS.length - 1; i++) {
    if (hourFrac >= STOPS[i].h && hourFrac < STOPS[i + 1].h) {
      lo = STOPS[i]; hi = STOPS[i + 1]; break;
    }
  }

  const t = (hourFrac - lo.h) / ((hi.h - lo.h) || 1);

  const keys: Array<keyof Omit<Stop, "h">> = [
    "base","surface","surface2","border","borderMid",
    "text","textDim","textMuted","accent","accentMid","accentDim","sky",
  ];

  const out: Partial<Stop> = { h: hourFrac };
  for (const k of keys) out[k] = lerp(lo[k], hi[k], t) as never;
  return { ...out as Stop, hourFrac };
}

export function applyPalette(p: ReturnType<typeof computePalette>) {
  const r = document.documentElement.style;
  r.setProperty("--base",         p.base);
  r.setProperty("--surface",      p.surface);
  r.setProperty("--surface-2",    p.surface2);
  r.setProperty("--border",       p.border);
  r.setProperty("--border-mid",   p.borderMid);
  r.setProperty("--text",         p.text);
  r.setProperty("--text-dim",     p.textDim);
  r.setProperty("--text-muted",   p.textMuted);
  r.setProperty("--indigo-bright",p.accent);
  r.setProperty("--indigo",       p.accentMid);
  r.setProperty("--indigo-dim",   p.accentDim);
  r.setProperty("--sky",          p.sky);
}
