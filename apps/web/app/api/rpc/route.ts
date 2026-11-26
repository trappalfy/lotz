import { env } from "@/lib/server/env";
import { allow, clientIp } from "@/lib/server/ratelimit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * JSON-RPC proxy for the browser, so the RPC key stays on the server. Only the methods the site uses are passed.
 * When the RPC answers 429 (its allowance is used up), fails or does not answer in time, the call goes to the
 * fallback RPC instead (the public one on mainnet), so a busy minute degrades speed, not the site.
 */
const ALLOWED = new Set([
  "getAccountInfo",
  "getBalance",
  "getBlockHeight",
  "getEpochInfo",
  "getFeeForMessage",
  "getGenesisHash",
  "getHealth",
  "getLatestBlockhash",
  "getMinimumBalanceForRentExemption",
  "getMultipleAccounts",
  "getRecentPrioritizationFees",
  "getSignatureStatuses",
  "getSlot",
  "getTokenAccountBalance",
  "getTokenAccountsByOwner",
  "getTransaction",
  "getVersion",
  "isBlockhashValid",
  "sendTransaction",
  "simulateTransaction",
]);

type RpcCall = { jsonrpc?: string; id?: unknown; method?: unknown; params?: unknown };

export async function POST(req: Request) {
  if (!allow(`rpc:${clientIp(req)}`, 300, 60)) {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: 429, message: "rate limited" } }, { status: 429 });
  }
  const text = await req.text();
  if (text.length > 100_000) return new Response("too large", { status: 413 });
  let body: RpcCall | RpcCall[];
  try {
    body = JSON.parse(text);
  } catch {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }, { status: 400 });
  }
  const calls = Array.isArray(body) ? body : [body];
  if (calls.length === 0 || calls.length > 20) return new Response("bad batch", { status: 400 });
  for (const c of calls) {
    if (typeof c.method !== "string" || !ALLOWED.has(c.method)) {
      return Response.json(
        { jsonrpc: "2.0", id: c.id ?? null, error: { code: -32601, message: `method not allowed: ${String(c.method)}` } },
        { status: 403 },
      );
    }
  }
  let upstream = await forward(env.rpcUrl(), text);
  const fallback = env.rpcFallbackUrl();
  if (fallback && (!upstream || limited(upstream))) {
    const second = await forward(fallback, text);
    if (second && !limited(second) && second.status < 400) upstream = second;
  }
  if (!upstream) {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32603, message: "RPC unavailable" } }, { status: 502 });
  }
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

type Upstream = { status: number; body: string };

/** Rate limited or failing: HTTP 429 or 5xx, or a JSON-RPC error with a rate-limit code inside a 200. */
function limited(u: Upstream): boolean {
  return u.status === 429 || u.status >= 500 || /"code"\s*:\s*-32(429|005)\b/.test(u.body.slice(0, 300));
}

/** One POST to an RPC; null when it could not be reached or took over 10 s. */
async function forward(url: string, body: string): Promise<Upstream | null> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    return { status: res.status, body: await res.text() };
  } catch {
    return null;
  }
}
