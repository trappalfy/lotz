/**
 * Indexer process:
 * - websocket `logsSubscribe` on the program for fast updates;
 * - `getSignaturesForAddress` polling as the source of truth (catches anything the socket missed);
 * - optional Helius webhook endpoint;
 * - periodic reconciliation from account state, hourly OG card;
 * - LISTEN on the moderation channel to re-render hidden/unhidden ads;
 * - automatic screening of new ad images (local model, `NSFW_FILTER=off` to turn it off);
 * - HTTP: /health, /stream (live updates for the site), /webhooks/helius.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { createPool, migrate, MODERATION_CHANNEL } from "@lotz/db";
import { screenRaw, screeningFromEnv, warmUp } from "@lotz/moderation";
import { storageFromEnv } from "@lotz/storage";
import { Chain } from "./chain";
import { createHttpServer } from "./http";
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
const thresholds = screeningFromEnv();
const screen = thresholds
  ? async (raw: Uint8Array, width: number, height: number) => {
      try {
        const v = await screenRaw(raw, width, height, 4, thresholds);
        return v.unsafe;
      } catch (e) {
        log("image screening failed", { error: String(e) });
        return null;
      }
    }
  : undefined;
if (thresholds) await warmUp();
const indexer = new Indexer({ chain: new Chain(connection, programId), pool, storage, log, screen });

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

// health, live stream for browsers, Helius webhook
const port = Number(env.PORT || env.INDEXER_PORT || 4100);
const host = env.INDEXER_HOST || "127.0.0.1";
createHttpServer({ indexer, storage, webhookSecret: env.HELIUS_WEBHOOK_SECRET ?? "", log }).listen(port, host, () =>
  log("http listening", { host, port }),
);
