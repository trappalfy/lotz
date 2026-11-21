import { env } from "@/lib/server/env";
import { allow, clientIp } from "@/lib/server/ratelimit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * JSON-RPC proxy for the browser, so the RPC key stays on the server. Only the methods the site uses are passed.
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
  const upstream = await fetch(env.rpcUrl(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: text,
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
