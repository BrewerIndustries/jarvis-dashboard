// Ambient time-of-day theme engine.
// Interpolates CSS custom properties across named time stops, updated every 60s.
// Applied to :root every minute by useAmbientTheme().

interface Stop {
  h: number;
  accent:    string; // --indigo-bright
  accentMid: string; // --indigo
  accentDim: string; // --indigo-dim
  base:      string; // --base
  sky:       string; // rgba overlay on body gradient — the most visible signal
  textAlpha: number;
}

const STOPS: Stop[] = [
  {
    h: 0,
    accent:    "#5848b0",
    accentMid: "#3c2e90",
    accentDim: "rgba(68,52,140,0.13)",
    base:      "#070710",
    sky:       "rgba(18,8,55,0.22)",
    textAlpha: 0.55,
  },
  {
    h: 5,
    accent:    "#6070d0",
    accentMid: "#4450b0",
    accentDim: "rgba(80,80,180,0.14)",
    base:      "#080a18",
    sky:       "rgba(20,30,90,0.18)",
    textAlpha: 0.60,
  },
  {
    h: 8,
    // Morning: noticeably cool blue — clearly different from noon purple
    accent:    "#7aaeff",
    accentMid: "#5888e0",
    accentDim: "rgba(90,130,220,0.16)",
    base:      "#090c18",
    sky:       "rgba(30,55,140,0.12)",
    textAlpha: 0.70,
  },
  {
    h: 12,
    // Noon: peak brightness, classic indigo
    accent:    "#a090ff",
    accentMid: "#7864dc",
    accentDim: "rgba(120,100,220,0.16)",
    base:      "#0d0d18",
    sky:       "rgba(60,40,120,0.06)",
    textAlpha: 0.85,
  },
  {
    h: 15,
    // Warm shift begins
    accent:    "#d4aa50",
    accentMid: "#b08830",
    accentDim: "rgba(190,150,50,0.15)",
    base:      "#0e0c12",
    sky:       "rgba(150,110,20,0.09)",
    textAlpha: 0.82,
  },
  {
    h: 17,
    // Golden hour
    accent:    "#f0c030",
    accentMid: "#c89010",
    accentDim: "rgba(220,170,20,0.16)",
    base:      "#100d0e",
    sky:       "rgba(210,150,10,0.14)",
    textAlpha: 0.80,
  },
  {
    h: 19,
    // Sunset — deep amber
    accent:    "#e07030",
    accentMid: "#b85010",
    accentDim: "rgba(200,90,30,0.15)",
    base:      "#0e0b0b",
    sky:       "rgba(190,80,15,0.14)",
    textAlpha: 0.73,
  },
  {
    h: 21,
    // Dusk — settling purple
    accent:    "#9060c0",
    accentMid: "#6840a8",
    accentDim: "rgba(120,60,180,0.14)",
    base:      "#0b090f",
    sky:       "rgba(90,30,110,0.14)",
    textAlpha: 0.65,
  },
  {
    h: 23,
    accent:    "#6858b0",
    accentMid: "#4840a0",
    accentDim: "rgba(80,60,150,0.13)",
    base:      "#080810",
    sky:       "rgba(18,8,55,0.20)",
    textAlpha: 0.58,
  },
  {
    h: 24,
    accent:    "#5848b0",
    accentMid: "#3c2e90",
    accentDim: "rgba(68,52,140,0.13)",
    base:      "#070710",
    sky:       "rgba(18,8,55,0.22)",
    textAlpha: 0.55,
  },
];

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

export interface AmbientPalette {
  accent:    string;
  accentMid: string;
  accentDim: string;
  base:      string;
  sky:       string;
  textAlpha: number;
  hourFrac:  number;
}

export function computePalette(date: Date = new Date()): AmbientPalette {
  const hourFrac = date.getHours() + date.getMinutes() / 60;

  let lo = STOPS[STOPS.length - 2];
  let hi = STOPS[STOPS.length - 1];
  for (let i = 0; i < STOPS.length - 1; i++) {
    if (hourFrac >= STOPS[i].h && hourFrac < STOPS[i + 1].h) {
      lo = STOPS[i];
      hi = STOPS[i + 1];
      break;
    }
  }

  const span = hi.h - lo.h || 1;
  const t = (hourFrac - lo.h) / span;
  const ln = (a: number, b: number) => a + (b - a) * t;

  return {
    accent:    hexLerp(lo.accent,    hi.accent,    t),
    accentMid: hexLerp(lo.accentMid, hi.accentMid, t),
    accentDim: rgbaLerp(lo.accentDim, hi.accentDim, t),
    base:      hexLerp(lo.base,      hi.base,      t),
    sky:       rgbaLerp(lo.sky,      hi.sky,       t),
    textAlpha: ln(lo.textAlpha, hi.textAlpha),
    hourFrac,
  };
}

export function applyPalette(p: AmbientPalette) {
  const r = document.documentElement.style;
  r.setProperty("--indigo-bright", p.accent);
  r.setProperty("--indigo",        p.accentMid);
  r.setProperty("--indigo-dim",    p.accentDim);
  r.setProperty("--base",          p.base);
  r.setProperty("--sky",           p.sky);
  r.setProperty("--text",          `rgba(255,255,255,${p.textAlpha.toFixed(2)})`);
  r.setProperty("--text-dim",      `rgba(255,255,255,${(p.textAlpha * 0.46).toFixed(2)})`);
  r.setProperty("--text-muted",    `rgba(255,255,255,${(p.textAlpha * 0.27).toFixed(2)})`);
}
