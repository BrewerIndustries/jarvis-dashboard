// Maps dashboard projects to their live deployments so the board can show real,
// per-environment health instead of a hand-set lane. Mirrors the launcher's
// apps.ts model (dev instance = prod port + 10, or an explicit dev URL).
//
// The dashboard's own JARVIS_ENV decides which side we point at: the DEV board
// (:4510) health-checks the DEV instances, the prod board (:4500) the prod ones.
// So the same project can read "live" on one board and "down"/absent on the other.

export type DeployEnv = "dev" | "prod";

/** Which environment this dashboard instance represents (matches page.tsx). */
export function activeEnv(): DeployEnv {
  if (process.env.PORT === "4500") return "prod"; // hard prod-port guard
  return process.env.JARVIS_ENV === "dev" ? "dev" : "prod";
}

export interface Deployment {
  /** Must match the dashboard project's title exactly. */
  title: string;
  /** Internal app: port the PROD instance listens on (DEV defaults to +10). */
  prodPort?: number;
  devPort?: number;
  /** Internal app served over (self-signed) TLS on its port. */
  https?: boolean;
  /** External app (e.g. GitHub Pages): explicit URLs, bypassing the port scheme. */
  prodUrl?: string;
  devUrl?: string;
}

// Verified reachable from the jarvis server (probed dev + prod, all 200):
// dashboard/launcher are plain HTTP on localhost; voice is self-signed HTTPS;
// the games are on GitHub Pages (/ for prod, /dev/ for dev).
const DEPLOYMENTS: Deployment[] = [
  { title: "Jarvis Dashboard", prodPort: 4500 },
  { title: "Jarvis Launcher", prodPort: 4400 },
  { title: "Jarvis", prodPort: 8080, https: true },
  {
    title: "Stellar Ascent",
    prodUrl: "https://stellar-ascent.dabrewer.dev/",
    devUrl: "https://stellar-ascent.dabrewer.dev/dev/",
  },
  {
    title: "Space Base Race",
    prodUrl: "https://spacebaserace.dabrewer.dev/",
    devUrl: "https://spacebaserace.dabrewer.dev/dev/",
  },
];

export function deployments(): Deployment[] {
  return DEPLOYMENTS;
}

/**
 * URL to health-check for the given environment, or null if this deployment
 * has no instance in that environment (→ the project keeps its manual lane there).
 */
export function targetUrl(d: Deployment, env: DeployEnv = activeEnv()): string | null {
  const override = env === "dev" ? d.devUrl : d.prodUrl;
  if (override) return override;
  if (d.prodPort) {
    const port = env === "dev" ? d.devPort ?? d.prodPort + 10 : d.prodPort;
    return `${d.https ? "https" : "http"}://localhost:${port}`;
  }
  return null;
}
