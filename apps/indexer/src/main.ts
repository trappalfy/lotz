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
import { createPool, lastModerationId, listen, migrate, MODERATION_CHANNEL } from "@lotz/db";
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
const log = (msg: string, extra?: Record<string, unknown>) =>
  console.log(JSON.stringify({ t: new Date().toISOString(), msg, ...extra }));
const pool = createPool(need("DATABASE_URL"), { onError: (e) => log("database connection closed", { error: e.message }) });
const storage = storageFromEnv();

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
// the token's dollar price for "≈ $" on the site: the pump.fun curve (one account read), then Jupiter. Mainnet only
// (a local token has no market); TOKEN_PRICE=on|off overrides.
const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const pricing = env.TOKEN_PRICE ? env.TOKEN_PRICE === "on" : (await connection.getGenesisHash().catch(() => "")) === MAINNET_GENESIS;
if (pricing) {
  const price = () => indexer.refreshPrice().catch((e) => log("price failed", { error: String(e) }));
  void price();
  setInterval(price, Number(env.PRICE_INTERVAL_MS ?? 15_000));
  // tokens locked on Streamflow, counted with the board's lock in "locked % of supply"
  const streamflow = () => indexer.refreshStreamflow().catch((e) => log("streamflow failed", { error: String(e) }));
  void streamflow();
  setInterval(streamflow, 60_000);
}
const og = () => indexer.renderOg().catch((e) => log("og failed", { error: String(e) }));
await og();
setInterval(og, 60 * 60_000);

// moderation changes from the web app. Neon closes the connection whenever it suspends an idle database; listen()
// connects again, and if anything was moderated in the meantime (its notification is lost), every ad is rechecked.
let moderationSeen = -1;
listen(
  pool,
  MODERATION_CHANNEL,
  (payload) => {
    try {
      const { adIds } = JSON.parse(payload) as { adIds?: number[] };
      indexer.onModeration(adIds ?? []).catch((e) => log("moderation failed", { error: String(e) }));
    } catch {
      /* ignore malformed payloads */
    }
  },
  {
    onConnect: (again) => {
      lastModerationId(pool)
        .then((id) => {
          const missed = again && id !== moderationSeen;
          moderationSeen = id;
          if (missed) return indexer.resyncModeration();
        })
        .catch((e) => log("moderation catch-up failed", { error: String(e) }));
    },
    onError: (e) => log("moderation listener reconnecting", { error: String((e as Error)?.message ?? e) }),
  },
);

// health, live stream for browsers, Helius webhook
const port = Number(env.PORT || env.INDEXER_PORT || 4100);
const host = env.INDEXER_HOST || "127.0.0.1";
createHttpServer({ indexer, storage, webhookSecret: env.HELIUS_WEBHOOK_SECRET ?? "", log }).listen(port, host, () =>
  log("http listening", { host, port }),
);
