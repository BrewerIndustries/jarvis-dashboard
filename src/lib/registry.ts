// Reads the unified project registry produced by scripts/sync-registry.mjs, which
// aggregates each repo's committed .jarvis.json. This is the single source of truth
// the dashboard (and, eventually, the launcher) share: declared lifecycle status
// drives the LANE; the /api/health ping drives the live/down badge.
//
// If the registry hasn't been synced yet, registry() returns [] and the dashboard
// gracefully falls back to each project's hand-set lane with no badges.

import { readFileSync } from "node:fs";
import { join } from "node:path";

export type DeployEnv = "dev" | "prod";
export type Lane = "live" | "in_progress" | "ideas" | "mothballed";

/** Which environment this dashboard instance represents (matches page.tsx). */
export function activeEnv(): DeployEnv {
  if (process.env.PORT === "4500") return "prod"; // hard prod-port guard
  return process.env.JARVIS_ENV === "dev" ? "dev" : "prod";
}

interface DeployTarget {
  url?: string;
  port?: number;
  https?: boolean;
}

export interface RegistryEntry {
  id?: string;
  name: string; // matches the dashboard project's title
  category?: string;
  repo?: string;
  /** Per-env lifecycle lane, or a single value applied to both. */
  status: { prod: Lane; dev: Lane } | Lane;
  /** How to reach/health-check each env's instance. */
  deploy?: { prod?: DeployTarget; dev?: DeployTarget };
}

export function registry(): RegistryEntry[] {
  const path = process.env.JARVIS_REGISTRY_PATH ?? join(process.cwd(), "data", "registry.json");
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (Array.isArray(parsed)) return parsed as RegistryEntry[];
  } catch {
    /* not synced yet — caller falls back */
  }
  return [];
}

/** Declared lane for the given environment. */
export function laneFor(e: RegistryEntry, env: DeployEnv = activeEnv()): Lane {
  return typeof e.status === "string" ? e.status : env === "dev" ? e.status.dev : e.status.prod;
}

/** URL to health-check for the given env, or null if there's no instance there. */
export function targetUrl(e: RegistryEntry, env: DeployEnv = activeEnv()): string | null {
  const t = e.deploy?.[env];
  if (!t) return null;
  if (t.url) return t.url;
  if (t.port) return `${t.https ? "https" : "http"}://localhost:${t.port}`;
  return null;
}
