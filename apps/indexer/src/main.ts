/**
 * Indexer process:
 * - websocket `logsSubscribe` on the program for fast updates;
 * - `getSignaturesForAddress` polling as the source of truth (catches anything the socket missed);
 * - optional Helius webhook endpoint;
 * - periodic reconciliation from account state, hourly OG card;
 * - LISTEN on the moderation channel to re-render hidden/unhidden ads.
 */
import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { Connection, PublicKey } from "@solana/web3.js";
import { createPool, migrate, MODERATION_CHANNEL } from "@lotz/db";
import { storageFromEnv } from "@lotz/storage";
import { Chain } from "./chain";
import { Indexer } from "./indexer";
import { pollOnce } from "./poll";

const env = process.env;
const need = (k: string): string => {
  const v = env[k];
  if (!v) throw new Error(`${k} is not set`);
  return v;
};

const RPC_URL = need("RPC_URL");
const programId = new PublicKey(need("PROGRAM_ID"));
const connection = new Connection(RPC_URL, { commitment: "confirmed", wsEndpoint: env.RPC_WS_URL || undefined });
const pool = createPool(need("DATABASE_URL"));
const storage = storageFromEnv();
const log = (msg: string, extra?: Record<string, unknown>) =>
  console.log(JSON.stringify({ t: new Date().toISOString(), msg, ...extra }));

await migrate(pool);
const indexer = new Indexer({ chain: new Chain(connection, programId), pool, storage, log });

const poll = () => pollOnce(connection, programId, pool, indexer);

let polling = false;
async function safePoll(): Promise<void> {
  if (polling) return;
  polling = true;
  try {
    await poll();
  } catch (e) {
    log("poll failed", { error: String(e) });
  } finally {
    polling = false;
  }
}

log("starting", { rpc: RPC_URL.replace(/api-key=[^&]+/, "api-key=***"), programId: programId.toBase58() });
// backfill on top of the last known state, publish once afterwards
await indexer.load();
indexer.quiet = true;
await safePoll();
indexer.quiet = false;
await indexer.init();
log("initial sync done");

connection.onLogs(
  programId,
  (l, ctx) => {
    indexer.handleLogs(l.signature, ctx.slot, l.logs, !!l.err).catch((e) => log("logs failed", { error: String(e) }));
  },
  "confirmed",
);

setInterval(safePoll, Number(env.POLL_INTERVAL_MS ?? 15_000));
setInterval(() => indexer.periodic().catch((e) => log("periodic failed", { error: String(e) })), 60_000);
setInterval(() => indexer.fullReconcile().catch((e) => log("reconcile failed", { error: String(e) })), 15 * 60_000);
const og = () => indexer.renderOg().catch((e) => log("og failed", { error: String(e) }));
await og();
setInterval(og, 60 * 60_000);

// moderation changes from the web app
const listener = await pool.connect();
await listener.query(`listen ${MODERATION_CHANNEL}`);
listener.on("notification", (n) => {
  try {
    const { adIds } = JSON.parse(n.payload ?? "{}") as { adIds?: number[] };
    indexer.onModeration(adIds ?? []).catch((e) => log("moderation failed", { error: String(e) }));
  } catch {
    /* ignore malformed payloads */
  }
});

// health and Helius webhook
const secret = env.HELIUS_WEBHOOK_SECRET ?? "";
const port = Number(env.INDEXER_PORT ?? 4100);
createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true }));
    return;
  }
  if (req.method === "POST" && req.url === "/webhooks/helius") {
    const auth = Buffer.from(req.headers.authorization ?? "");
    const want = Buffer.from(secret);
    if (!secret || auth.length !== want.length || !timingSafeEqual(auth, want)) {
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
          if (sig && /^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(sig)) indexer.handleSignature(sig).catch(() => {});
        }
        res.writeHead(200).end();
      } catch {
        res.writeHead(400).end();
      }
    });
    return;
  }
  res.writeHead(404).end();
}).listen(port, "127.0.0.1", () => log("http listening", { port }));
