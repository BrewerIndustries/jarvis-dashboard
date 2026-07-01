// Ambient time-of-day theme engine.
//
// Schedule:
//   Midnight–6am  → dark mode (deep indigo)
//   6am–noon      → fade dark → light
//   Noon          → full light mode
//   Noon–4pm      → fade light → warm
//   4pm–8pm       → golden hour
//   8pm–midnight  → fade back to dark
//
// KEY DESIGN: backgrounds/accents interpolate smoothly.
// Text color is derived from background luminance — never interpolated —
// so contrast is always guaranteed (no gray-on-gray midpoint).

interface BgStop {
  h:          number;
  base:       string;  // hex
  surface:    string;  // hex
  surface2:   string;  // hex
  border:     string;  // rgba
  borderMid:  string;  // rgba
  accent:     string;  // hex  — --indigo-bright
  accentMid:  string;  // hex  — --indigo
  accentDim:  string;  // rgba — --indigo-dim
  sky:        string;  // rgba — radial overlay on body bg
}

// ── stops ────────────────────────────────────────────────────────────────────

const STOPS: BgStop[] = [
  {
    h: 0,   // midnight — deep dark indigo
    base:      "#07070f",
    surface:   "#0e0e1c",
    surface2:  "#141426",
    border:    "rgba(255,255,255,0.06)",
    borderMid: "rgba(255,255,255,0.10)",
    accent:    "#6050c8",
    accentMid: "#4838a8",
    accentDim: "rgba(70,55,160,0.14)",
    sky:       "rgba(14,8,48,0.30)",
  },
  {
    h: 6,   // dawn — same darkness, transition starts here
    base:      "#09090f",
    surface:   "#101020",
    surface2:  "#161630",
    border:    "rgba(255,255,255,0.07)",
    borderMid: "rgba(255,255,255,0.11)",
    accent:    "#6858c8",
    accentMid: "#5040a8",
    accentDim: "rgba(80,65,170,0.15)",
    sky:       "rgba(20,12,60,0.24)",
  },
  {
    h: 12,  // noon — full light mode
    base:      "#eeeef8",
    surface:   "#ffffff",
    surface2:  "#f4f4fc",
    border:    "rgba(50,30,140,0.09)",
    borderMid: "rgba(50,30,140,0.16)",
    accent:    "#4830cc",
    accentMid: "#3620b0",
    accentDim: "rgba(68,48,200,0.12)",
    sky:       "rgba(80,55,200,0.06)",
  },
  {
    h: 16,  // 4pm — golden transition begins
    base:      "#1a1208",
    surface:   "#261a0c",
    surface2:  "#301f0e",
    border:    "rgba(230,165,40,0.12)",
    borderMid: "rgba(230,165,40,0.20)",
    accent:    "#e8a828",
    accentMid: "#c08010",
    accentDim: "rgba(212,148,20,0.18)",
    sky:       "rgba(195,128,10,0.18)",
  },
  {
    h: 18,  // 6pm — golden hour peak
    base:      "#120a03",
    surface:   "#1e1408",
    surface2:  "#271908",
    border:    "rgba(245,175,30,0.15)",
    borderMid: "rgba(245,175,30,0.25)",
    accent:    "#f0b828",
    accentMid: "#c89010",
    accentDim: "rgba(230,165,20,0.22)",
    sky:       "rgba(215,140,8,0.24)",
  },
  {
    h: 20,  // 8pm — golden fading to dark
    base:      "#0c0907",
    surface:   "#141110",
    surface2:  "#1b1815",
    border:    "rgba(200,130,40,0.09)",
    borderMid: "rgba(200,130,40,0.14)",
    accent:    "#8858b0",
    accentMid: "#6038a0",
    accentDim: "rgba(110,55,155,0.15)",
    sky:       "rgba(85,40,105,0.20)",
  },
  {
    h: 24,  // back to midnight
    base:      "#07070f",
    surface:   "#0e0e1c",
    surface2:  "#141426",
    border:    "rgba(255,255,255,0.06)",
    borderMid: "rgba(255,255,255,0.10)",
    accent:    "#6050c8",
    accentMid: "#4838a8",
    accentDim: "rgba(70,55,160,0.14)",
    sky:       "rgba(14,8,48,0.30)",
  },
];

// ── interpolation ─────────────────────────────────────────────────────────────

function hexLerp(a: string, b: string, t: number): string {
  const p = (h: string) => {
    const x = parseInt(h.replace("#", ""), 16);
    return [(x >> 16) & 255, (x >> 8) & 255, x & 255];
  };
  const L = (x: number, y: number) => Math.round(x + (y - x) * t);
  const [ar, ag, ab] = p(a), [br, bg, bb] = p(b);
  return `#${[L(ar,br),L(ag,bg),L(ab,bb)].map(v=>v.toString(16).padStart(2,"0")).join("")}`;
}

function rgbaLerp(a: string, b: string, t: number): string {
  const p = (s: string) => s.match(/[\d.]+/g)!.map(Number) as [number,number,number,number];
  const L = (x: number, y: number) => x + (y - x) * t;
  const [ar,ag,ab,aa] = p(a), [br,bg,bb,ba] = p(b);
  return `rgba(${Math.round(L(ar,br))},${Math.round(L(ag,bg))},${Math.round(L(ab,bb))},${L(aa,ba).toFixed(2)})`;
}

// ── luminance-based text (guarantees contrast) ────────────────────────────────

function relativeLuminance(hex: string): number {
  const p = (h: string) => parseInt(h, 16) / 255;
  const lin = (c: number) => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  const r = lin(p(hex.slice(1, 3)));
  const g = lin(p(hex.slice(3, 5)));
  const b = lin(p(hex.slice(5, 7)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function textForBase(baseHex: string): { text: string; textDim: string; textMuted: string } {
  const lum = relativeLuminance(baseHex);

  if (lum > 0.12) {
    // Light background → dark text
    return {
      text:      "rgba(12,10,36,0.90)",
      textDim:   "rgba(12,10,36,0.50)",
      textMuted: "rgba(12,10,36,0.32)",
    };
  }

  // Dark background — check warmth for golden hour tint
  const r = parseInt(baseHex.slice(1, 3), 16);
  const g = parseInt(baseHex.slice(3, 5), 16);
  const b = parseInt(baseHex.slice(5, 7), 16);
  const isWarm = r > g + 8 && r > b + 8;

  if (isWarm) {
    return {
      text:      "rgba(255,235,185,0.92)",
      textDim:   "rgba(255,215,140,0.52)",
      textMuted: "rgba(255,195,100,0.34)",
    };
  }

  // Cool dark → white text
  return {
    text:      "rgba(255,255,255,0.82)",
    textDim:   "rgba(255,255,255,0.38)",
    textMuted: "rgba(255,255,255,0.22)",
  };
}

// ── public API ────────────────────────────────────────────────────────────────

export interface AmbientPalette extends BgStop {
  text:      string;
  textDim:   string;
  textMuted: string;
  hourFrac:  number;
}

export function computePalette(date: Date = new Date()): AmbientPalette {
  const hourFrac = date.getHours() + date.getMinutes() / 60;

  let lo = STOPS[STOPS.length - 2];
  let hi = STOPS[STOPS.length - 1];
  for (let i = 0; i < STOPS.length - 1; i++) {
    if (hourFrac >= STOPS[i].h && hourFrac < STOPS[i + 1].h) {
      lo = STOPS[i]; hi = STOPS[i + 1]; break;
    }
  }

  const t = (hourFrac - lo.h) / ((hi.h - lo.h) || 1);

  const base      = hexLerp(lo.base,      hi.base,      t);
  const surface   = hexLerp(lo.surface,   hi.surface,   t);
  const surface2  = hexLerp(lo.surface2,  hi.surface2,  t);
  const border    = rgbaLerp(lo.border,   hi.border,    t);
  const borderMid = rgbaLerp(lo.borderMid,hi.borderMid, t);
  const accent    = hexLerp(lo.accent,    hi.accent,    t);
  const accentMid = hexLerp(lo.accentMid, hi.accentMid, t);
  const accentDim = rgbaLerp(lo.accentDim,hi.accentDim, t);
  const sky       = rgbaLerp(lo.sky,      hi.sky,       t);

  const { text, textDim, textMuted } = textForBase(base);

  return { h: hourFrac, base, surface, surface2, border, borderMid,
           accent, accentMid, accentDim, sky, text, textDim, textMuted, hourFrac };
}

export function applyPalette(p: AmbientPalette) {
  const r = document.documentElement.style;
  r.setProperty("--base",          p.base);
  r.setProperty("--surface",       p.surface);
  r.setProperty("--surface-2",     p.surface2);
  r.setProperty("--border",        p.border);
  r.setProperty("--border-mid",    p.borderMid);
  r.setProperty("--text",          p.text);
  r.setProperty("--text-dim",      p.textDim);
  r.setProperty("--text-muted",    p.textMuted);
  r.setProperty("--indigo-bright", p.accent);
  r.setProperty("--indigo",        p.accentMid);
  r.setProperty("--indigo-dim",    p.accentDim);
  r.setProperty("--sky",           p.sky);
}
