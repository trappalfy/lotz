/**
 * Fetches a URL taken from on-chain data without letting it reach our own network (SSRF): https only, every
 * resolved address must be public, the connection goes to the address that was checked (no DNS rebinding),
 * no redirects, a size cap and a timeout.
 */
import { lookup as dnsLookup } from "node:dns";
import { isIP } from "node:net";
import { Agent, fetch } from "undici";

export interface SafeFetchOptions {
  maxBytes: number;
  timeoutMs: number;
  /** Tests only: allow plain http and private addresses. */
  allowPrivate?: boolean;
}

function v4Public(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number) as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
  if (a === 169 && b === 254) return false; // link-local, cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0) return false; // 192.0.0.0/24, 192.0.2.0/24
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a === 198 && b === 51) return false;
  if (a === 203 && b === 0) return false;
  if (a >= 224) return false; // multicast, reserved, broadcast
  return true;
}

export function isPublicAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return v4Public(ip);
  if (kind === 6) {
    const x = ip.toLowerCase();
    if (x === "::" || x === "::1") return false;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(x);
    if (mapped) return v4Public(mapped[1]!);
    if (x.startsWith("fc") || x.startsWith("fd")) return false; // unique local
    if (/^fe[89ab]/.test(x)) return false; // link-local
    if (x.startsWith("ff")) return false; // multicast
    if (x.startsWith("2001:db8")) return false; // documentation
    if (x.startsWith("64:ff9b")) return false; // NAT64 can reach v4 private space
    return true;
  }
  return false;
}

export async function safeFetch(url: string, opts: SafeFetchOptions): Promise<Uint8Array> {
  const u = new URL(url);
  if (u.protocol !== "https:" && !(opts.allowPrivate && u.protocol === "http:")) {
    throw new Error("only https URLs are fetched");
  }
  if (u.username || u.password) throw new Error("credentials in URL");

  const agent = new Agent({
    connect: {
      timeout: opts.timeoutMs,
      lookup(hostname, options, cb) {
        dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
          if (err) return cb(err, "", 0);
          const list = addresses as unknown as { address: string; family: number }[];
          const bad = list.find((a) => !opts.allowPrivate && !isPublicAddress(a.address));
          if (bad || list.length === 0) return cb(new Error(`blocked address for ${hostname}`), "", 0);
          const first = list[0]!;
          // undici asks for all addresses when `options.all` is set
          if ((options as { all?: boolean }).all) return (cb as unknown as (e: null, a: typeof list) => void)(null, list);
          cb(null, first.address, first.family);
        });
      },
    },
  });

  if (isIP(u.hostname) && !opts.allowPrivate && !isPublicAddress(u.hostname)) throw new Error("blocked address");

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);
  try {
    const res = await fetch(u, { dispatcher: agent, redirect: "manual", signal: ctrl.signal, headers: { accept: "image/*" } });
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared > opts.maxBytes) throw new Error("too large");
    const reader = res.body?.getReader();
    if (!reader) throw new Error("no body");
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > opts.maxBytes) {
        await reader.cancel();
        throw new Error("too large");
      }
      chunks.push(value);
    }
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      out.set(c, off);
      off += c.length;
    }
    return out;
  } finally {
    clearTimeout(timer);
    await agent.close().catch(() => {});
  }
}
