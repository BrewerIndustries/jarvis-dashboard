import { NextResponse } from "next/server";
import * as http from "node:http";
import * as https from "node:https";
import { activeEnv, registry, targetUrl } from "@/lib/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TIMEOUT_MS = 2500;

// Any HTTP response (even 401/404) means the server is up; only a connection
// failure or timeout counts as offline. Internal Jarvis services use self-signed
// TLS, so https pings pass rejectUnauthorized:false — scoped to this ping only.
function ping(url: string): Promise<{ ok: boolean; ms: number }> {
  return new Promise((resolve) => {
    const start = Date.now();
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      resolve({ ok, ms: Date.now() - start });
    };
    const onRes = (res: http.IncomingMessage) => {
      res.resume(); // drain so the socket can close
      finish(true);
    };
    try {
      const isHttps = url.startsWith("https");
      const req = isHttps
        ? https.get(url, { timeout: TIMEOUT_MS, rejectUnauthorized: false }, onRes)
        : http.get(url, { timeout: TIMEOUT_MS }, onRes);
      req.on("timeout", () => {
        req.destroy();
        finish(false);
      });
      req.on("error", () => finish(false));
    } catch {
      finish(false);
    }
  });
}

// GET /api/health — ping each registered deployment for THIS dashboard's environment
// (dev board → dev instances, prod board → prod). Returns the active env plus
// { [projectName]: { state, ms } } for every project that has an instance in this env.
export async function GET() {
  const env = activeEnv();
  const targets = registry()
    .map((e) => ({ name: e.name, url: targetUrl(e, env) }))
    .filter((t): t is { name: string; url: string } => t.url !== null);

  const entries = await Promise.all(
    targets.map(async ({ name, url }) => {
      const { ok, ms } = await ping(url);
      return [name, { state: ok ? "online" : "offline", ms }] as const;
    }),
  );

  return NextResponse.json(
    { env, apps: Object.fromEntries(entries) },
    { headers: { "cache-control": "no-store" } },
  );
}
