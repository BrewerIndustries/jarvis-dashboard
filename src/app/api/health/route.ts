import { NextResponse } from "next/server";
import * as dns from "node:dns";
import * as http from "node:http";
import * as https from "node:https";
import { activeEnv, registry, targetUrl } from "@/lib/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TIMEOUT_MS = 2500;
const DNS_TTL_MS = 10 * 60 * 1000;

// Node resolves names on a 4-thread pool. When the home connection drops a DNS
// packet, that lookup stalls for 5s, and the ~30 parallel pings queue behind it,
// so every app (even the ones on this box) timed out together. Cache each answer
// and serve it straight away, refreshing in the background once it's stale. A
// lookup only ever waits the first time a name is seen.
type Addr = { address: string; family: number };
const dnsCache = new Map<string, { addr: Addr; at: number }>();
const refreshing = new Set<string>();

function resolve(hostname: string, cb: (err: Error | null, addr?: Addr) => void) {
  dns.lookup(hostname, { family: 4 }, (err, address, family) => {
    if (err) return cb(err);
    const addr = { address, family };
    dnsCache.set(hostname, { addr, at: Date.now() });
    cb(null, addr);
  });
}

function cachedLookup(
  hostname: string,
  options: dns.LookupOptions,
  cb: (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void,
) {
  const reply = (addr: Addr) =>
    options.all ? cb(null, [addr]) : cb(null, addr.address, addr.family);
  const hit = dnsCache.get(hostname);
  if (hit) {
    if (Date.now() - hit.at > DNS_TTL_MS && !refreshing.has(hostname)) {
      refreshing.add(hostname);
      resolve(hostname, () => refreshing.delete(hostname));
    }
    return process.nextTick(() => reply(hit.addr));
  }
  resolve(hostname, (err, addr) => (err ? cb(err, "") : reply(addr!)));
}

// Any HTTP response (even 401/404) means the server is up; only a connection
// failure or timeout counts as offline. Internal Jarvis services use self-signed
// TLS, so https pings pass rejectUnauthorized:false — scoped to this ping only.
function pingOnce(url: string): Promise<{ ok: boolean; ms: number }> {
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
        ? https.get(url, { timeout: TIMEOUT_MS, rejectUnauthorized: false, lookup: cachedLookup }, onRes)
        : http.get(url, { timeout: TIMEOUT_MS, lookup: cachedLookup }, onRes);
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

// A failed ping gets one retry, so a single dropped packet doesn't show as offline.
async function ping(url: string): Promise<{ ok: boolean; ms: number }> {
  const first = await pingOnce(url);
  if (first.ok) return first;
  const second = await pingOnce(url);
  return { ok: second.ok, ms: first.ms + second.ms };
}

// GET /api/health — ping each registered deployment for THIS dashboard's environment
// (dev board → dev instances, prod board → prod). Returns the active env plus
// { [projectName]: { state, ms } } for every project that has an instance in this env.
export async function GET() {
  const env = activeEnv();
  const targets = registry()
    .map((e) => ({ id: e.id, url: targetUrl(e, env) }))
    .filter((t): t is { id: string; url: string } => t.url !== null);

  const entries = await Promise.all(
    targets.map(async ({ id, url }) => {
      const { ok, ms } = await ping(url);
      return [id, { state: ok ? "online" : "offline", ms }] as const;
    }),
  );

  return NextResponse.json(
    { env, apps: Object.fromEntries(entries) },
    { headers: { "cache-control": "no-store" } },
  );
}
