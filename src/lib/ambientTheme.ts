// Two-mode theme: light (7am–8pm) and dark (8pm–7am).
// Light palette sourced exactly from dans-recipes.dabrewer.dev

const LIGHT = {
  base:       "#f9f7f4",
  surface:    "#ffffff",
  surface2:   "#f0ebe4",
  border:     "rgba(224,216,208,0.80)",
  borderMid:  "rgba(224,216,208,1.00)",
  text:       "rgba(26,26,26,0.90)",
  textDim:    "rgba(102,102,102,0.90)",
  textMuted:  "rgba(102,102,102,0.55)",
  accent:     "#5c3d2e",
  accentMid:  "#4a2e1e",
  accentDim:  "rgba(92,61,46,0.12)",
  sky:        "rgba(92,61,46,0.03)",
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
