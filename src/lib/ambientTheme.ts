// Ambient time-of-day theme engine.
// Interpolates CSS custom properties across named time stops.
// Applied to :root every minute by useAmbientTheme().

interface Stop {
  h: number;           // hour (0–24, 24 wraps to 0)
  accent: string;      // --indigo-bright
  accentMid: string;   // --indigo
  accentDim: string;   // --indigo-dim (rgba)
  base: string;        // --base  (background)
  textAlpha: number;   // --text  (rgba alpha 0–1)
}

// Named palette stops throughout the day
const STOPS: Stop[] = [
  {
    h: 0,
    accent:    "#6858b8",
    accentMid: "#4c42a0",
    accentDim: "rgba(88,72,160,0.13)",
    base:      "#080810",
    textAlpha: 0.58,
  },
  {
    h: 5,
    accent:    "#7868c8",
    accentMid: "#5c50b0",
    accentDim: "rgba(100,88,180,0.14)",
    base:      "#09091a",
    textAlpha: 0.62,
  },
  {
    h: 8,
    accent:    "#9080e8",
    accentMid: "#7060cc",
    accentDim: "rgba(110,90,200,0.15)",
    base:      "#0b0b14",
    textAlpha: 0.72,
  },
  {
    h: 12,
    // Peak brightness — crisp cool white-blue
    accent:    "#a090ff",
    accentMid: "#7864dc",
    accentDim: "rgba(120,100,220,0.16)",
    base:      "#0d0d18",
    textAlpha: 0.85,
  },
  {
    h: 15,
    // Warm shift begins
    accent:    "#c8a860",
    accentMid: "#a07830",
    accentDim: "rgba(180,140,60,0.14)",
    base:      "#0d0b14",
    textAlpha: 0.82,
  },
  {
    h: 17,
    // Golden hour — warm gold
    accent:    "#e8b828",
    accentMid: "#c09018",
    accentDim: "rgba(210,160,20,0.14)",
    base:      "#0f0c10",
    textAlpha: 0.80,
  },
  {
    h: 19,
    // Sunset — deep amber
    accent:    "#d07030",
    accentMid: "#a05020",
    accentDim: "rgba(190,90,30,0.14)",
    base:      "#0d0a0c",
    textAlpha: 0.73,
  },
  {
    h: 21,
    // Dusk — settling purples
    accent:    "#9060b8",
    accentMid: "#6840a0",
    accentDim: "rgba(120,60,170,0.14)",
    base:      "#0a0910",
    textAlpha: 0.65,
  },
  {
    h: 23,
    // Night — deep indigo, dim
    accent:    "#7060a8",
    accentMid: "#504090",
    accentDim: "rgba(88,64,150,0.13)",
    base:      "#080810",
    textAlpha: 0.60,
  },
  {
    h: 24, // wraps to 0
    accent:    "#6858b8",
    accentMid: "#4c42a0",
    accentDim: "rgba(88,72,160,0.13)",
    base:      "#080810",
    textAlpha: 0.58,
  },
];

// Interpolate 0–1 between two hex colors
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

// Parse rgba(r,g,b,a) into components, lerp, reserialize
function rgbaLerp(a: string, b: string, t: number): string {
  const parse = (s: string) =>
    s.match(/[\d.]+/g)!.map(Number) as [number, number, number, number];
  const lerp = (x: number, y: number) => x + (y - x) * t;
  const [ar, ag, ab, aa] = parse(a);
  const [br, bg, bb, ba] = parse(b);
  return `rgba(${Math.round(lerp(ar, br))},${Math.round(lerp(ag, bg))},${Math.round(lerp(ab, bb))},${lerp(aa, ba).toFixed(2)})`;
}

function lerpNum(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

export interface AmbientPalette {
  accent:    string;
  accentMid: string;
  accentDim: string;
  base:      string;
  textAlpha: number;
  hourFrac:  number; // 0–24, for label
}

export function computePalette(date: Date = new Date()): AmbientPalette {
  const hourFrac = date.getHours() + date.getMinutes() / 60;

  // Find surrounding stops
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

  return {
    accent:    hexLerp(lo.accent,    hi.accent,    t),
    accentMid: hexLerp(lo.accentMid, hi.accentMid, t),
    accentDim: rgbaLerp(lo.accentDim, hi.accentDim, t),
    base:      hexLerp(lo.base,      hi.base,      t),
    textAlpha: lerpNum(lo.textAlpha, hi.textAlpha, t),
    hourFrac,
  };
}

export function applyPalette(p: AmbientPalette) {
  const r = document.documentElement.style;
  r.setProperty("--indigo-bright", p.accent);
  r.setProperty("--indigo",        p.accentMid);
  r.setProperty("--indigo-dim",    p.accentDim);
  r.setProperty("--base",          p.base);
  r.setProperty("--text",          `rgba(255,255,255,${p.textAlpha.toFixed(2)})`);
  // Derived muted/dim at fixed fractions of textAlpha
  r.setProperty("--text-dim",      `rgba(255,255,255,${(p.textAlpha * 0.46).toFixed(2)})`);
  r.setProperty("--text-muted",    `rgba(255,255,255,${(p.textAlpha * 0.27).toFixed(2)})`);
}
