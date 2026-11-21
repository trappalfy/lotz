/** The purchase flow against the chain: fresh quote, transaction, send. */
import { Connection, PublicKey } from "@solana/web3.js";
import {
  LotzInstructions,
  MAX_PRIOR_ADS,
  applyShard,
  ata,
  buyComputeUnits,
  buyEpoch,
  chainTime,
  computeBudgetIxs,
  emptyBoard,
  fetchConfig,
  fetchShards,
  quoteRect,
  randomNonce,
  shardsForRect,
  type ConfigAccount,
  type Quote,
  type Rect,
} from "@lotz/sdk";
import type { BoardData } from "./board-data";
import { prepare, signAndSend, simulateUnits, type SignTx } from "./send";

export interface FreshQuote {
  quote: Quote;
  config: ConfigAccount;
  priorAds: PublicKey[];
  /** Ids of prior ads owned by the buyer (the program refuses taking your own lot). */
  ownAdIds: number[];
}

export class BoardBehindError extends Error {
  constructor() {
    super("The board is updating. Try again in a few seconds.");
  }
}

/** Prices the rectangle from the shards as they are on-chain right now. */
export async function freshQuote(
  connection: Connection,
  ixs: LotzInstructions,
  board: BoardData,
  rect: Rect,
  buyer: PublicKey | null,
): Promise<FreshQuote> {
  const [config, shards] = await Promise.all([
    fetchConfig(connection, ixs.pdas),
    fetchShards(connection, ixs.pdas, shardsForRect(rect)),
  ]);
  if (!config) throw new Error("Lotz is not initialized on this cluster.");
  const lots = emptyBoard();
  for (const [index, l] of shards) applyShard(lots, { index, lots: l });
  const quote = quoteRect(lots, rect, config);
  const priorAds: PublicKey[] = [];
  const ownAdIds: number[] = [];
  for (const id of quote.priorAdIds) {
    const ad = board.ads.get(id);
    if (!ad) throw new BoardBehindError();
    if (buyer && ad.owner === buyer.toBase58()) ownAdIds.push(id);
    priorAds.push(new PublicKey(ad.address));
  }
  return { quote, config, priorAds, ownAdIds };
}

export async function tokenBalance(connection: Connection, ixs: LotzInstructions, owner: PublicKey): Promise<bigint> {
  try {
    const r = await connection.getTokenAccountBalance(ata(owner, ixs.d.mint, ixs.d.tokenProgram), "confirmed");
    return BigInt(r.value.amount);
  } catch {
    return 0n;
  }
}

export interface BuyContent {
  imageHash: Uint8Array;
  imageUri: string;
  link: string;
  title: string;
}

/**
 * Re-quotes, builds the `buy` transaction with max_total = the fresh total, has the wallet sign it and waits for
 * confirmation. Throws if the price is above `acceptUpTo` (the total the buyer saw).
 */
export async function buy(
  connection: Connection,
  ixs: LotzInstructions,
  board: BoardData,
  buyer: PublicKey,
  sign: SignTx,
  rect: Rect,
  content: BuyContent,
  acceptUpTo: bigint,
  opts: { lookupTable: string | null; priorityMicroLamports: number },
  onStatus?: (s: "quoting" | "signing" | "sending" | "confirming") => void,
): Promise<{ signature: string; total: bigint }> {
  onStatus?.("quoting");
  const fq = await freshQuote(connection, ixs, board, rect, buyer);
  if (fq.ownAdIds.length) throw new Error("You already own some of these lots. Move or shrink the selection.");
  if (fq.priorAds.length > MAX_PRIOR_ADS) {
    throw new Error(`This spot takes lots from ${fq.priorAds.length} ads; at most ${MAX_PRIOR_ADS} per purchase. Make it smaller.`);
  }
  if (fq.quote.total > acceptUpTo) {
    throw new PriceMovedError(fq.quote.total);
  }
  const now = await chainTime(connection);
  const ix = ixs.buy(
    buyer,
    {
      nonce: randomNonce(),
      ...rect,
      epoch: buyEpoch(now, fq.config),
      maxTotal: fq.quote.total,
      imageHash: content.imageHash,
      imageUri: content.imageUri,
      link: content.link,
      title: content.title,
    },
    fq.priorAds,
  );
  // size check first (a probe with the largest limit), then the real limit from a simulation
  const fallback = buyComputeUnits(rect.w * rect.h, fq.priorAds.length);
  await prepare(connection, buyer, [...computeBudgetIxs(fallback, opts.priorityMicroLamports), ix], opts.lookupTable);
  const used = await simulateUnits(connection, buyer, [...computeBudgetIxs(400_000, 0), ix], opts.lookupTable);
  const units = used ? Math.min(400_000, Math.ceil(used * 1.15) + 10_000) : fallback;
  const prepared = await prepare(connection, buyer, [...computeBudgetIxs(units, opts.priorityMicroLamports), ix], opts.lookupTable);
  const signature = await signAndSend(connection, sign, prepared, onStatus);
  return { signature, total: fq.quote.total };
}

export class PriceMovedError extends Error {
  constructor(readonly total: bigint) {
    super("The price went up since you opened this. Check the new total and pay again.");
  }
}
