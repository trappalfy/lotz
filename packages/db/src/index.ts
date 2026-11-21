/**
 * Postgres access for the indexer and the web app. Plain SQL over `pg`; token amounts are bigint in TypeScript and
 * numeric(20,0) in the database.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

export type Pool = pg.Pool;
export type Client = pg.PoolClient;
type Q = Pick<pg.Pool, "query">;

/** Channel the indexer notifies on after each board change; the web app's SSE stream listens on it. */
export const STREAM_CHANNEL = "lotz_stream";
/** Channel the web app notifies on after a moderation change; the indexer re-renders. */
export const MODERATION_CHANNEL = "lotz_moderation";

export function createPool(
  connectionString = process.env.DATABASE_URL,
  opts: { max?: number; idleTimeoutMillis?: number } = {},
): Pool {
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  return new pg.Pool({ connectionString, max: opts.max ?? 10, idleTimeoutMillis: opts.idleTimeoutMillis ?? 10_000 });
}

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), "../migrations");

/** Applies every migration not yet applied, each in its own transaction. */
export async function migrate(pool: Pool): Promise<string[]> {
  await pool.query(
    "create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())",
  );
  const done = new Set((await pool.query<{ name: string }>("select name from schema_migrations")).rows.map((r) => r.name));
  const applied: string[] = [];
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    if (done.has(file)) continue;
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(readFileSync(join(MIGRATIONS, file), "utf8"));
      await client.query("insert into schema_migrations (name) values ($1)", [file]);
      await client.query("commit");
      applied.push(file);
    } catch (e) {
      await client.query("rollback");
      throw e;
    } finally {
      client.release();
    }
  }
  return applied;
}

export async function notify(db: Q, channel: string, payload: unknown): Promise<void> {
  await db.query("select pg_notify($1, $2)", [channel, JSON.stringify(payload)]);
}

const big = (v: string | null | undefined): bigint => (v == null ? 0n : BigInt(v));
const str = (v: bigint): string => v.toString();

// ------------------------------------------------------------------ config

export interface ConfigRow {
  programId: string;
  admin: string;
  tokenMint: string;
  tokenProgram: string;
  tokenDecimals: number;
  treasury: string;
  basePrice: bigint;
  tierSize: number;
  tierMultBps: number;
  takeoverMultBps: number;
  maxRect: number;
  lockPeriod: number;
  epochLen: number;
  launchTs: number;
  lotsSold: number;
  takeovers: number;
  totalLocked: bigint;
  totalReleased: bigint;
  nextAdId: number;
  paused: boolean;
  upgradeAuthority: string | null;
  lockVault: string;
  refundVault: string;
  updatedAt: Date;
}

export async function upsertConfig(db: Q, c: Omit<ConfigRow, "updatedAt">): Promise<void> {
  await db.query(
    `insert into chain_config (id, program_id, admin, token_mint, token_program, token_decimals, treasury, base_price,
       tier_size, tier_mult_bps, takeover_mult_bps, max_rect, lock_period, epoch_len, launch_ts, lots_sold, takeovers,
       total_locked, total_released, next_ad_id, paused, upgrade_authority, lock_vault, refund_vault, updated_at)
     values (1,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23, now())
     on conflict (id) do update set program_id=$1, admin=$2, token_mint=$3, token_program=$4, token_decimals=$5,
       treasury=$6, base_price=$7, tier_size=$8, tier_mult_bps=$9, takeover_mult_bps=$10, max_rect=$11,
       lock_period=$12, epoch_len=$13, launch_ts=$14, lots_sold=$15, takeovers=$16, total_locked=$17,
       total_released=$18, next_ad_id=$19, paused=$20, upgrade_authority=$21, lock_vault=$22, refund_vault=$23,
       updated_at=now()`,
    [
      c.programId,
      c.admin,
      c.tokenMint,
      c.tokenProgram,
      c.tokenDecimals,
      c.treasury,
      str(c.basePrice),
      c.tierSize,
      c.tierMultBps,
      c.takeoverMultBps,
      c.maxRect,
      c.lockPeriod,
      c.epochLen,
      c.launchTs,
      c.lotsSold,
      c.takeovers,
      str(c.totalLocked),
      str(c.totalReleased),
      c.nextAdId,
      c.paused,
      c.upgradeAuthority,
      c.lockVault,
      c.refundVault,
    ],
  );
}

export async function getConfig(db: Q): Promise<ConfigRow | null> {
  const r = (await db.query("select * from chain_config where id = 1")).rows[0];
  if (!r) return null;
  return {
    programId: r.program_id,
    admin: r.admin,
    tokenMint: r.token_mint,
    tokenProgram: r.token_program,
    tokenDecimals: r.token_decimals,
    treasury: r.treasury,
    basePrice: big(r.base_price),
    tierSize: r.tier_size,
    tierMultBps: r.tier_mult_bps,
    takeoverMultBps: r.takeover_mult_bps,
    maxRect: r.max_rect,
    lockPeriod: Number(r.lock_period),
    epochLen: Number(r.epoch_len),
    launchTs: Number(r.launch_ts),
    lotsSold: r.lots_sold,
    takeovers: Number(r.takeovers),
    totalLocked: big(r.total_locked),
    totalReleased: big(r.total_released),
    nextAdId: Number(r.next_ad_id),
    paused: r.paused,
    upgradeAuthority: r.upgrade_authority,
    lockVault: r.lock_vault,
    refundVault: r.refund_vault,
    updatedAt: r.updated_at,
  };
}

// ------------------------------------------------------------------ ads

export interface AdRow {
  adId: number;
  address: string;
  owner: string;
  nonce: bigint;
  x: number;
  y: number;
  w: number;
  h: number;
  imageHash: string;
  imageUri: string;
  link: string;
  linkDomain: string | null;
  title: string;
  paidTotal: bigint;
  lotsAlive: number;
  refundDue: bigint;
  closed: boolean;
  createdAt: Date;
  createdSlot: number | null;
  signature: string | null;
  hidden: boolean;
  hiddenReason: string | null;
  hiddenAt: Date | null;
  imageStatus: "pending" | "ok" | "mismatch" | "error";
  imageKey: string | null;
  imageError: string | null;
}

function adRow(r: Record<string, any>): AdRow {
  return {
    adId: Number(r.ad_id),
    address: r.address,
    owner: r.owner,
    nonce: big(r.nonce),
    x: r.x,
    y: r.y,
    w: r.w,
    h: r.h,
    imageHash: r.image_hash,
    imageUri: r.image_uri,
    link: r.link,
    linkDomain: r.link_domain,
    title: r.title,
    paidTotal: big(r.paid_total),
    lotsAlive: r.lots_alive,
    refundDue: big(r.refund_due),
    closed: r.closed,
    createdAt: r.created_at,
    createdSlot: r.created_slot == null ? null : Number(r.created_slot),
    signature: r.signature,
    hidden: r.hidden,
    hiddenReason: r.hidden_reason,
    hiddenAt: r.hidden_at,
    imageStatus: r.image_status,
    imageKey: r.image_key,
    imageError: r.image_error,
  };
}

export type NewAd = Omit<
  AdRow,
  "hidden" | "hiddenReason" | "hiddenAt" | "imageStatus" | "imageKey" | "imageError" | "closed" | "refundDue"
> & { refundDue?: bigint; closed?: boolean };

/** Inserts an ad if it is new; existing rows keep their moderation and image state. Returns true if inserted. */
export async function insertAd(db: Q, a: NewAd): Promise<boolean> {
  const res = await db.query(
    `insert into ads (ad_id, address, owner, nonce, x, y, w, h, image_hash, image_uri, link, link_domain, title,
       paid_total, lots_alive, refund_due, closed, created_at, created_slot, signature)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
     on conflict (ad_id) do nothing`,
    [
      a.adId,
      a.address,
      a.owner,
      str(a.nonce),
      a.x,
      a.y,
      a.w,
      a.h,
      a.imageHash,
      a.imageUri,
      a.link,
      a.linkDomain,
      a.title,
      str(a.paidTotal),
      a.lotsAlive,
      str(a.refundDue ?? 0n),
      a.closed ?? false,
      a.createdAt,
      a.createdSlot,
      a.signature,
    ],
  );
  return (res.rowCount ?? 0) > 0;
}

/** On-chain state of an ad (from its account, or `closed` when the account is gone). */
export async function updateAdState(
  db: Q,
  adId: number,
  s: { lotsAlive: number; refundDue: bigint; closed: boolean },
): Promise<void> {
  await db.query("update ads set lots_alive=$2, refund_due=$3, closed=$4 where ad_id=$1", [
    adId,
    s.lotsAlive,
    str(s.refundDue),
    s.closed,
  ]);
}

export async function getAd(db: Q, adId: number): Promise<AdRow | null> {
  const r = (await db.query("select * from ads where ad_id=$1", [adId])).rows[0];
  return r ? adRow(r) : null;
}

export async function getAdsByIds(db: Q, ids: number[]): Promise<AdRow[]> {
  if (ids.length === 0) return [];
  return (await db.query("select * from ads where ad_id = any($1::bigint[])", [ids])).rows.map(adRow);
}

export async function getAdsByOwner(db: Q, owner: string): Promise<AdRow[]> {
  return (await db.query("select * from ads where owner=$1 order by ad_id desc", [owner])).rows.map(adRow);
}

/** Ads that still own at least one lot (what the board shows). */
export async function getLiveAds(db: Q): Promise<AdRow[]> {
  return (await db.query("select * from ads where lots_alive > 0 order by ad_id")).rows.map(adRow);
}

export async function getAllOpenAds(db: Q): Promise<AdRow[]> {
  return (await db.query("select * from ads where not closed order by ad_id")).rows.map(adRow);
}

export async function listRecentAds(db: Q, limit: number, beforeId?: number): Promise<AdRow[]> {
  const res = beforeId
    ? await db.query("select * from ads where ad_id < $1 order by ad_id desc limit $2", [beforeId, limit])
    : await db.query("select * from ads order by ad_id desc limit $1", [limit]);
  return res.rows.map(adRow);
}

export async function setAdImage(
  db: Q,
  adId: number,
  status: AdRow["imageStatus"],
  key: string | null,
  error: string | null,
): Promise<void> {
  await db.query("update ads set image_status=$2, image_key=$3, image_error=$4 where ad_id=$1", [adId, status, key, error]);
}

export async function setHidden(db: Q, adId: number, hidden: boolean, reason: string | null, by: string | null): Promise<void> {
  await db.query(
    `update ads set hidden=$2, hidden_reason=case when $2 then $3 else null end,
       hidden_by=case when $2 then $4 else null end, hidden_at=case when $2 then now() else null end where ad_id=$1`,
    [adId, hidden, reason, by],
  );
}

// ------------------------------------------------------------------ lots

export interface LotRow {
  lot: number;
  adId: number;
  lastPrice: bigint;
  takeovers: number;
  firstPrice: bigint | null;
  firstSoldAt: Date | null;
}

function lotRow(r: Record<string, any>): LotRow {
  return {
    lot: r.lot,
    adId: Number(r.ad_id),
    lastPrice: big(r.last_price),
    takeovers: r.takeovers,
    firstPrice: r.first_price == null ? null : big(r.first_price),
    firstSoldAt: r.first_sold_at,
  };
}

/** Writes the current owner and price of many lots (from the shards). */
export async function setLots(db: Q, lots: { lot: number; adId: number; lastPrice: bigint }[]): Promise<void> {
  if (lots.length === 0) return;
  await db.query(
    `update lots l set ad_id = v.ad_id, last_price = v.last_price
     from unnest($1::int[], $2::bigint[], $3::numeric[]) as v(lot, ad_id, last_price)
     where l.lot = v.lot and (l.ad_id <> v.ad_id or l.last_price <> v.last_price)`,
    [lots.map((l) => l.lot), lots.map((l) => l.adId), lots.map((l) => str(l.lastPrice))],
  );
}

/** Records a purchase's effect on lot history: first sale price/time for free lots, +1 takeover for taken ones. */
export async function recordLotHistory(
  db: Q,
  freeLots: number[],
  firstPrice: bigint,
  at: Date,
  takenLots: number[],
): Promise<void> {
  if (freeLots.length > 0) {
    await db.query(
      "update lots set first_price = coalesce(first_price, $2), first_sold_at = coalesce(first_sold_at, $3) where lot = any($1::int[])",
      [freeLots, str(firstPrice), at],
    );
  }
  if (takenLots.length > 0) {
    await db.query("update lots set takeovers = takeovers + 1 where lot = any($1::int[])", [takenLots]);
  }
}

export async function getAllLots(db: Q): Promise<LotRow[]> {
  return (await db.query("select * from lots order by lot")).rows.map(lotRow);
}

export async function getLot(db: Q, lot: number): Promise<LotRow | null> {
  const r = (await db.query("select * from lots where lot=$1", [lot])).rows[0];
  return r ? lotRow(r) : null;
}

export async function getLotsOfAd(db: Q, adId: number): Promise<number[]> {
  return (await db.query<{ lot: number }>("select lot from lots where ad_id=$1 order by lot", [adId])).rows.map((r) => r.lot);
}

/** The lot with the most takeovers (ties: the earliest sold). */
export async function getMostTakenLot(db: Q): Promise<LotRow | null> {
  const r = (
    await db.query("select * from lots where takeovers > 0 order by takeovers desc, first_sold_at asc nulls last, lot limit 1")
  ).rows[0];
  return r ? lotRow(r) : null;
}

// ------------------------------------------------------------------ events

export interface EventRow {
  id: number;
  signature: string;
  eventIndex: number;
  slot: number;
  blockTime: Date;
  name: string;
  adId: number | null;
  actor: string | null;
  data: Record<string, unknown>;
}

function eventRow(r: Record<string, any>): EventRow {
  return {
    id: Number(r.id),
    signature: r.signature,
    eventIndex: r.event_index,
    slot: Number(r.slot),
    blockTime: r.block_time,
    name: r.name,
    adId: r.ad_id == null ? null : Number(r.ad_id),
    actor: r.actor,
    data: r.data,
  };
}

export interface NewEvent {
  signature: string;
  eventIndex: number;
  slot: number;
  blockTime: Date;
  name: string;
  adId: number | null;
  actor: string | null;
  rect?: { x: number; y: number; w: number; h: number };
  data: Record<string, unknown>;
}

/** Returns the new row id, or null if the event was already stored. */
export async function insertEvent(db: Q, e: NewEvent): Promise<number | null> {
  const res = await db.query<{ id: string }>(
    `insert into events (signature, event_index, slot, block_time, name, ad_id, actor, x, y, w, h, data)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) on conflict (signature, event_index) do nothing returning id`,
    [
      e.signature,
      e.eventIndex,
      e.slot,
      e.blockTime,
      e.name,
      e.adId,
      e.actor,
      e.rect?.x ?? null,
      e.rect?.y ?? null,
      e.rect?.w ?? null,
      e.rect?.h ?? null,
      JSON.stringify(e.data),
    ],
  );
  const id = res.rows[0]?.id;
  return id == null ? null : Number(id);
}

export async function hasSignature(db: Q, signature: string): Promise<boolean> {
  return ((await db.query("select 1 from events where signature=$1 limit 1", [signature])).rowCount ?? 0) > 0;
}

/** Purchases (newest first), optionally only before an event id. */
export async function getActivity(db: Q, limit: number, beforeId?: number): Promise<EventRow[]> {
  const res = beforeId
    ? await db.query("select * from events where name='LotsBought' and id < $1 order by id desc limit $2", [beforeId, limit])
    : await db.query("select * from events where name='LotsBought' order by id desc limit $1", [limit]);
  return res.rows.map(eventRow);
}

/** Every purchase whose rectangle covered lot (lx, ly), oldest first. */
export async function getLotHistory(db: Q, lx: number, ly: number): Promise<EventRow[]> {
  return (
    await db.query(
      `select * from events where name='LotsBought' and x <= $1 and $1 < x + w and y <= $2 and $2 < y + h order by id`,
      [lx, ly],
    )
  ).rows.map(eventRow);
}

export async function getEventsOfAd(db: Q, adId: number): Promise<EventRow[]> {
  return (await db.query("select * from events where ad_id=$1 order by id", [adId])).rows.map(eventRow);
}

// ------------------------------------------------------------------ epochs

export interface EpochRow {
  epoch: number;
  address: string;
  amount: bigint;
  unlockAt: Date;
  released: boolean;
  releasedAt: Date | null;
  releaseSignature: string | null;
}

export async function upsertEpoch(
  db: Q,
  e: { epoch: number; address: string; amount: bigint; unlockAt: Date; released: boolean },
): Promise<void> {
  await db.query(
    `insert into lock_epochs (epoch, address, amount, unlock_at, released) values ($1,$2,$3,$4,$5)
     on conflict (epoch) do update set amount=$3, unlock_at=$4, released=$5`,
    [e.epoch, e.address, str(e.amount), e.unlockAt, e.released],
  );
}

export async function markEpochReleased(db: Q, epoch: number, at: Date, signature: string): Promise<void> {
  await db.query(
    "update lock_epochs set released=true, released_at=coalesce(released_at, $2), release_signature=coalesce(release_signature, $3) where epoch=$1",
    [epoch, at, signature],
  );
}

export async function getEpochs(db: Q): Promise<EpochRow[]> {
  return (await db.query("select * from lock_epochs order by epoch")).rows.map((r) => ({
    epoch: r.epoch,
    address: r.address,
    amount: big(r.amount),
    unlockAt: r.unlock_at,
    released: r.released,
    releasedAt: r.released_at,
    releaseSignature: r.release_signature,
  }));
}

// ------------------------------------------------------------------ moderation

export async function getBlockedDomains(db: Q): Promise<{ domain: string; note: string | null; addedAt: Date }[]> {
  return (await db.query("select * from blocked_domains order by domain")).rows.map((r) => ({
    domain: r.domain,
    note: r.note,
    addedAt: r.added_at,
  }));
}

export async function addBlockedDomain(db: Q, domain: string, note: string | null, by: string): Promise<void> {
  await db.query(
    "insert into blocked_domains (domain, note, added_by) values ($1,$2,$3) on conflict (domain) do update set note=$2",
    [domain, note, by],
  );
}

export async function removeBlockedDomain(db: Q, domain: string): Promise<void> {
  await db.query("delete from blocked_domains where domain=$1", [domain]);
}

export async function logModeration(db: Q, admin: string, action: string, target: string, note?: string): Promise<void> {
  await db.query("insert into moderation_log (admin, action, target, note) values ($1,$2,$3,$4)", [
    admin,
    action,
    target,
    note ?? null,
  ]);
}

/** Ads (not closed) whose link domain is `domain` or one of its subdomains. */
export async function getAdsOnDomain(db: Q, domain: string): Promise<AdRow[]> {
  return (
    await db.query("select * from ads where link_domain = $1 or link_domain like $2", [domain, `%.${domain}`])
  ).rows.map(adRow);
}

// ------------------------------------------------------------------ processed signatures

export async function markProcessed(db: Q, signatures: string[]): Promise<void> {
  if (signatures.length === 0) return;
  await db.query("insert into processed_signatures (signature) select unnest($1::text[]) on conflict do nothing", [signatures]);
}

/** The subset of `signatures` already processed. */
export async function processedAmong(db: Q, signatures: string[]): Promise<Set<string>> {
  if (signatures.length === 0) return new Set();
  const r = await db.query<{ signature: string }>("select signature from processed_signatures where signature = any($1::text[])", [signatures]);
  return new Set(r.rows.map((x) => x.signature));
}

// ------------------------------------------------------------------ rate limits

/**
 * Counts one request for `key` in the current fixed window and returns the count so far. Shared by every server
 * instance, unlike an in-memory limiter.
 */
export async function rateHit(db: Q, key: string, windowSeconds: number): Promise<number> {
  const r = await db.query<{ hits: number }>(
    `insert into rate_limits (key, window_start, hits)
     values ($1, to_timestamp(floor(extract(epoch from now()) / $2) * $2), 1)
     on conflict (key, window_start) do update set hits = rate_limits.hits + 1
     returning hits`,
    [key, windowSeconds],
  );
  if (Math.random() < 0.01) await db.query("delete from rate_limits where window_start < now() - interval '1 day'");
  return r.rows[0]!.hits;
}

// ------------------------------------------------------------------ uploads and kv

export async function insertUpload(
  db: Q,
  u: { hash: string; key: string; width: number; height: number; bytes: number },
): Promise<void> {
  await db.query(
    "insert into uploads (hash, key, width, height, bytes) values ($1,$2,$3,$4,$5) on conflict (hash) do nothing",
    [u.hash, u.key, u.width, u.height, u.bytes],
  );
}

export async function getUpload(db: Q, hash: string): Promise<{ key: string; width: number; height: number } | null> {
  const r = (await db.query("select key, width, height from uploads where hash=$1", [hash])).rows[0];
  return r ?? null;
}

export async function kvGet<T>(db: Q, key: string): Promise<T | null> {
  const r = (await db.query("select value from kv where key=$1", [key])).rows[0];
  return r ? (r.value as T) : null;
}

export async function kvSet(db: Q, key: string, value: unknown): Promise<void> {
  await db.query(
    "insert into kv (key, value, updated_at) values ($1,$2,now()) on conflict (key) do update set value=$2, updated_at=now()",
    [key, JSON.stringify(value)],
  );
}

/** What the renderer last published: versioned image keys the site loads. */
export interface BoardImages {
  version: number;
  renderedAt: string;
  x1: string;
  x2: string;
  /** 4x tiles: 4 x 4, each 25 x 25 lots at 1000 x 1000 px. Key per tile, row-major. */
  tiles: string[];
  og: string | null;
}

export const BOARD_IMAGES_KEY = "board_images";
