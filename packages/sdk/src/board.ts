/** Board geometry, shard decoding and quotes. */
import { BOARD_SIDE, LOTS_PER_SHARD, SHARD_SIDE, SHARDS_PER_SIDE, TOTAL_LOTS } from "./constants";
import { takeoverPrice, tierOf, tierPrice } from "./math";

/** A rectangle in lots. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One lot: the id of the ad on it (0 = never sold) and what its owner paid. */
export interface LotState {
  adId: number;
  lastPrice: bigint;
}

/** Global lot index, row-major over the board. */
export function lotIndex(lx: number, ly: number): number {
  return ly * BOARD_SIDE + lx;
}

export function shardIndexOf(lx: number, ly: number): number {
  return Math.floor(ly / SHARD_SIDE) * SHARDS_PER_SIDE + Math.floor(lx / SHARD_SIDE);
}

/** Position of a lot inside its shard's `lots` array. */
export function lotOffset(lx: number, ly: number): number {
  return (ly % SHARD_SIDE) * SHARD_SIDE + (lx % SHARD_SIDE);
}

/** Shards a rectangle touches, ascending (the order `buy` expects). */
export function shardsForRect(r: Rect): number[] {
  const out: number[] = [];
  for (let sy = Math.floor(r.y / SHARD_SIDE); sy <= Math.floor((r.y + r.h - 1) / SHARD_SIDE); sy++) {
    for (let sx = Math.floor(r.x / SHARD_SIDE); sx <= Math.floor((r.x + r.w - 1) / SHARD_SIDE); sx++) {
      out.push(sy * SHARDS_PER_SIDE + sx);
    }
  }
  return out;
}

export function rectInBounds(r: Rect, maxRect: number): boolean {
  return (
    Number.isInteger(r.x) &&
    Number.isInteger(r.y) &&
    Number.isInteger(r.w) &&
    Number.isInteger(r.h) &&
    r.x >= 0 &&
    r.y >= 0 &&
    r.w >= 1 &&
    r.h >= 1 &&
    r.w <= maxRect &&
    r.h <= maxRect &&
    r.x + r.w <= BOARD_SIDE &&
    r.y + r.h <= BOARD_SIDE
  );
}

export function* lotsOf(r: Rect): Generator<[number, number]> {
  for (let ly = r.y; ly < r.y + r.h; ly++) for (let lx = r.x; lx < r.x + r.w; lx++) yield [lx, ly];
}

/** Account size of a shard: 8-byte discriminator, 100 x (u64 ad_id, u64 last_price), u8 index, u8 bump, 6 pad. */
export const SHARD_ACCOUNT_LEN = 8 + LOTS_PER_SHARD * 16 + 8;

/** Decodes a shard account (zero-copy, little-endian). */
export function decodeShard(data: Uint8Array): { index: number; lots: LotState[] } {
  if (data.length < SHARD_ACCOUNT_LEN) throw new Error(`shard account too short: ${data.length}`);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const lots: LotState[] = [];
  for (let i = 0; i < LOTS_PER_SHARD; i++) {
    const off = 8 + i * 16;
    lots.push({ adId: Number(view.getBigUint64(off, true)), lastPrice: view.getBigUint64(off + 8, true) });
  }
  return { index: data[8 + LOTS_PER_SHARD * 16]!, lots };
}

/** The whole board as a flat array of 10,000 lots, indexed by `lotIndex`. */
export type BoardLots = LotState[];

export function emptyBoard(): BoardLots {
  return Array.from({ length: TOTAL_LOTS }, () => ({ adId: 0, lastPrice: 0n }));
}

/** Writes a decoded shard into a flat board. */
export function applyShard(board: BoardLots, shard: { index: number; lots: LotState[] }): void {
  const sx = (shard.index % SHARDS_PER_SIDE) * SHARD_SIDE;
  const sy = Math.floor(shard.index / SHARDS_PER_SIDE) * SHARD_SIDE;
  shard.lots.forEach((lot, i) => {
    const lx = sx + (i % SHARD_SIDE);
    const ly = sy + Math.floor(i / SHARD_SIDE);
    board[lotIndex(lx, ly)] = lot;
  });
}

/** Pricing parameters a quote needs (from the on-chain config). */
export interface PriceParams {
  basePrice: bigint;
  tierSize: number;
  tierMultBps: number;
  takeoverMultBps: number;
  lotsSold: number;
}

export interface Quote {
  total: bigint;
  /** Goes back to previous owners. */
  refunds: bigint;
  /** Goes to the lock. */
  locked: bigint;
  freeLots: number;
  takenLots: number;
  tier: number;
  freeLotPrice: bigint;
  /** Distinct ids of the ads that lose lots, in first-seen order. */
  priorAdIds: number[];
}

/** What a rectangle costs on the current board: free lots at the tier price, taken lots at 1.5x. */
export function quoteRect(board: BoardLots, r: Rect, p: PriceParams): Quote {
  const tier = tierOf(p.lotsSold, p.tierSize);
  const freeLotPrice = tierPrice(p.basePrice, p.tierMultBps, tier);
  let total = 0n;
  let refunds = 0n;
  let freeLots = 0;
  let takenLots = 0;
  const priorAdIds: number[] = [];
  for (const [lx, ly] of lotsOf(r)) {
    const lot = board[lotIndex(lx, ly)]!;
    if (lot.adId === 0) {
      freeLots++;
      total += freeLotPrice;
    } else {
      takenLots++;
      total += takeoverPrice(lot.lastPrice, p.takeoverMultBps);
      refunds += lot.lastPrice;
      if (!priorAdIds.includes(lot.adId)) priorAdIds.push(lot.adId);
    }
  }
  return { total, refunds, locked: total - refunds, freeLots, takenLots, tier, freeLotPrice, priorAdIds };
}
