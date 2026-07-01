// Two-mode theme: light (7am–8pm) and dark (8pm–7am).
// No interpolation — snaps cleanly between modes.

const LIGHT = {
  base:       "#f0ebe3",
  surface:    "#ffffff",
  surface2:   "#faf7f3",
  border:     "rgba(44,24,16,0.08)",
  borderMid:  "rgba(44,24,16,0.14)",
  text:       "rgba(44,24,16,0.88)",
  textDim:    "rgba(44,24,16,0.48)",
  textMuted:  "rgba(44,24,16,0.30)",
  accent:     "#5540cc",
  accentMid:  "#4030b0",
  accentDim:  "rgba(68,48,200,0.12)",
  sky:        "rgba(80,55,200,0.05)",
};

const DARK = {
  base:       "#0b0b12",
  surface:    "#13131d",
  surface2:   "#1a1a27",
  border:     "rgba(255,255,255,0.07)",
  borderMid:  "rgba(255,255,255,0.11)",
  text:       "rgba(255,255,255,0.82)",
  textDim:    "rgba(255,255,255,0.38)",
  textMuted:  "rgba(255,255,255,0.22)",
  accent:     "#7864dc",
  accentMid:  "#5848c0",
  accentDim:  "rgba(120,100,220,0.18)",
  sky:        "rgba(14,8,48,0.30)",
};

export type AmbientPalette = typeof LIGHT & { hourFrac: number };

function getPalette(): AmbientPalette {
  const now = new Date();
  const h = now.getHours();
  const p = (h >= 7 && h < 20) ? LIGHT : DARK;
  return { ...p, hourFrac: h + now.getMinutes() / 60 };
}

export function computePalette(): AmbientPalette {
  return getPalette();
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
