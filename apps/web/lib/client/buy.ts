/** The purchase flow against the chain: fresh quote, transaction, send. */
import { Connection, PublicKey, SYSVAR_CLOCK_PUBKEY } from "@solana/web3.js";
import {
  LotzInstructions,
  MAX_PRIOR_ADS,
  applyShard,
  ata,
  buyComputeUnits,
  buyEpoch,
  computeBudgetIxs,
  decodeConfig,
  decodeShard,
  emptyBoard,
  quoteRect,
  randomNonce,
  shardsForRect,
  type ConfigAccount,
  type Quote,
  type Rect,
} from "@lotz/sdk";
import type { BoardData } from "./board-data";
import { bus } from "./bus";
import { prepare, signAndSend, simulateUnits, type SendTx } from "./send";

export interface FreshQuote {
  quote: Quote;
  config: ConfigAccount;
  priorAds: PublicKey[];
  /** Ids of prior ads owned by the buyer (the program refuses taking your own lot). */
  ownAdIds: number[];
  /** Chain time (unix seconds) when quoted. */
  now: number;
}

export class BoardBehindError extends Error {
  constructor() {
    super("The board is updating. Try again in a few seconds.");
  }
}

/** Prices the rectangle from the shards as they are on-chain right now (config, clock and shards in one request). */
export async function freshQuote(
  connection: Connection,
  ixs: LotzInstructions,
  board: BoardData,
  rect: Rect,
  buyer: PublicKey | null,
): Promise<FreshQuote> {
  const indexes = shardsForRect(rect);
  const [configInfo, clockInfo, ...shardInfos] = await connection.getMultipleAccountsInfo(
    [ixs.pdas.config(), SYSVAR_CLOCK_PUBKEY, ...indexes.map((i) => ixs.pdas.shard(i))],
    "confirmed",
  );
  if (!configInfo) throw new Error("Lotz is not initialized on this cluster.");
  if (!clockInfo) throw new Error("no clock sysvar");
  const config = decodeConfig(configInfo.data);
  const now = Number(new DataView(clockInfo.data.buffer, clockInfo.data.byteOffset).getBigInt64(32, true));
  const lots = emptyBoard();
  for (const info of shardInfos) if (info) applyShard(lots, decodeShard(info.data));
  const quote = quoteRect(lots, rect, config);
  const priorAds: PublicKey[] = [];
  const ownAdIds: number[] = [];
  for (const id of quote.priorAdIds) {
    const ad = board.ads.get(id);
    if (!ad) throw new BoardBehindError();
    if (buyer && ad.owner === buyer.toBase58()) ownAdIds.push(id);
    priorAds.push(new PublicKey(ad.address));
  }
  return { quote, config, priorAds, ownAdIds, now };
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
  send: SendTx,
  rect: Rect,
  content: BuyContent,
  acceptUpTo: bigint,
  opts: { lookupTable: string | null; priorityMicroLamports: number },
  onStatus?: (s: "quoting" | "signing" | "sending" | "confirming") => void,
): Promise<{ signature: string; total: bigint }> {
  onStatus?.("quoting");
  const [fq, recent] = await Promise.all([freshQuote(connection, ixs, board, rect, buyer), connection.getLatestBlockhash("confirmed")]);
  if (fq.ownAdIds.length) throw new Error("You already own some of these lots. Move or shrink the selection.");
  if (fq.priorAds.length > MAX_PRIOR_ADS) {
    throw new Error(`This spot takes lots from ${fq.priorAds.length} ads; at most ${MAX_PRIOR_ADS} per purchase. Make it smaller.`);
  }
  if (fq.quote.total > acceptUpTo) {
    throw new PriceMovedError(fq.quote.total);
  }
  const ix = ixs.buy(
    buyer,
    {
      nonce: randomNonce(),
      ...rect,
      epoch: buyEpoch(fq.now, fq.config),
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
  await prepare(connection, buyer, [...computeBudgetIxs(fallback, opts.priorityMicroLamports), ix], opts.lookupTable, recent);
  const used = await simulateUnits(connection, buyer, [...computeBudgetIxs(400_000, 0), ix], opts.lookupTable);
  const units = used ? Math.min(400_000, Math.ceil(used * 1.15) + 10_000) : fallback;
  const prepared = await prepare(connection, buyer, [...computeBudgetIxs(units, opts.priorityMicroLamports), ix], opts.lookupTable, recent);
  const stream = watchStream();
  try {
    const signature = await signAndSend(connection, send, prepared, onStatus, stream.seen);
    return { signature, total: fq.quote.total };
  } finally {
    stream.stop();
  }
}

/** Purchases the live stream reports (from before the signature is known, so none slips through). */
function watchStream(): { seen: (signature: string) => Promise<void>; stop: () => void } {
  const got = new Set<string>();
  let want: string | null = null;
  let done: (() => void) | null = null;
  const stop = bus.on("buy", (b) => {
    got.add(b.signature);
    if (b.signature === want) done?.();
  });
  return {
    seen: (signature) => {
      want = signature;
      return got.has(signature) ? Promise.resolve() : new Promise<void>((r) => (done = r));
    },
    stop,
  };
}

export class PriceMovedError extends Error {
  constructor(readonly total: bigint) {
    super("The price went up since you opened this. Check the new total and pay again.");
  }
}
