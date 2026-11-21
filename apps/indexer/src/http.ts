/**
 * The indexer's HTTP endpoints:
 * - GET  /health
 * - GET  /stream            live updates for browsers (server-sent events, public, read-only)
 * - POST /webhooks/helius   optional; only tells the indexer which signatures to fetch
 *
 * The stream lives here rather than in the web app so the site can run on a serverless host (Vercel), where a
 * function cannot hold a connection open for long.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import type * as db from "@lotz/db";
import type { Storage } from "@lotz/storage";
import type { Indexer, StreamMessage } from "./indexer";

export interface HttpOptions {
  indexer: Pick<Indexer, "subscribe" | "snapshot" | "handleSignature">;
  storage: Pick<Storage, "publicUrl">;
  webhookSecret: string;
  log: (msg: string, extra?: Record<string, unknown>) => void;
  /** Open streams in total and per client address. */
  maxStreams?: number;
  maxStreamsPerIp?: number;
  heartbeatMs?: number;
}

export function createHttpServer(o: HttpOptions): Server {
  const maxStreams = o.maxStreams ?? 5_000;
  const maxPerIp = o.maxStreamsPerIp ?? 20;
  const heartbeatMs = o.heartbeatMs ?? 20_000;
  const perIp = new Map<string, number>();
  let open = 0;

  const images = (b: db.BoardImages | null) =>
    b && { version: b.version, x1: o.storage.publicUrl(b.x1), x2: o.storage.publicUrl(b.x2), tiles: b.tiles.map((k) => o.storage.publicUrl(k)) };
  const toClient = (m: StreamMessage) => JSON.stringify({ ...m, board: images(m.board) });

  function stream(req: IncomingMessage, res: ServerResponse): void {
    const ip = clientIp(req);
    if (open >= maxStreams || (perIp.get(ip) ?? 0) >= maxPerIp) {
      res.writeHead(503, { "retry-after": "30", "access-control-allow-origin": "*" }).end();
      return;
    }
    open++;
    perIp.set(ip, (perIp.get(ip) ?? 0) + 1);
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
      "access-control-allow-origin": "*",
    });
    res.socket?.setNoDelay(true);
    const send = (s: string) => {
      if (!res.writableEnded) res.write(s);
    };
    const snap = o.indexer.snapshot();
    send("retry: 3000\n");
    send(`data: ${JSON.stringify({ type: "hello", board: images(snap.board), stats: snap.stats })}\n\n`);
    const unsubscribe = o.indexer.subscribe((m) => send(`data: ${toClient(m)}\n\n`));
    const heartbeat = setInterval(() => send(": keep-alive\n\n"), heartbeatMs);
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      unsubscribe();
      clearInterval(heartbeat);
      open--;
      const n = (perIp.get(ip) ?? 1) - 1;
      if (n > 0) perIp.set(ip, n);
      else perIp.delete(ip);
    };
    req.on("close", close);
    res.on("close", close);
    res.on("error", close);
  }

  function webhook(req: IncomingMessage, res: ServerResponse): void {
    const auth = Buffer.from(req.headers.authorization ?? "");
    const want = Buffer.from(o.webhookSecret);
    if (!o.webhookSecret || auth.length !== want.length || !timingSafeEqual(auth, want)) {
      res.writeHead(401).end();
      return;
    }
    let body = "";
    req.on("data", (c) => {
      body += c;
      if (body.length > 5_000_000) req.destroy();
    });
    req.on("end", () => {
      try {
        const items = JSON.parse(body) as { signature?: string; transaction?: { signatures?: string[] } }[];
        for (const it of Array.isArray(items) ? items : []) {
          const sig = it.signature ?? it.transaction?.signatures?.[0];
          // The webhook only tells us *what* to look at; the transaction itself is always fetched from RPC.
          if (sig && /^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(sig)) o.indexer.handleSignature(sig).catch(() => {});
        }
        res.writeHead(200).end();
      } catch {
        res.writeHead(400).end();
      }
    });
  }

  return createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    if (req.method === "GET" && path === "/health") {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, streams: open }));
      return;
    }
    if (req.method === "GET" && path === "/stream") return stream(req, res);
    if (req.method === "OPTIONS" && path === "/stream") {
      res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-methods": "GET" }).end();
      return;
    }
    if (req.method === "POST" && path === "/webhooks/helius") return webhook(req, res);
    res.writeHead(404).end();
  });
}

/** Behind a proxy the last X-Forwarded-For hop is the one the proxy saw; otherwise the socket address. */
function clientIp(req: IncomingMessage): string {
  const fwd = req.headers["x-forwarded-for"];
  const list = (Array.isArray(fwd) ? fwd.join(",") : (fwd ?? "")).split(",").map((s) => s.trim()).filter(Boolean);
  return list.at(-1) ?? req.socket.remoteAddress ?? "unknown";
}
