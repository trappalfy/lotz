/** JSON shapes of the public API. Token amounts are decimal strings of base units. */

export interface DeploymentInfo {
  cluster: "localnet" | "devnet" | "mainnet-beta";
  programId: string;
  tokenMint: string | null;
  tokenProgram: string | null;
  tokenDecimals: number;
  treasury: string | null;
  lockVault: string | null;
  refundVault: string | null;
  lookupTable: string | null;
  upgradeAuthority: string | null;
  initialized: boolean;
  /** The browser talks to this RPC endpoint (our proxy unless overridden). */
  rpcUrl: string;
  /** Server-sent events with live updates: the indexer's /stream in production, or this site's /api/stream. */
  streamUrl: string;
  priorityMicroLamports: number;
  xUrl: string | null;
  sourceUrl: string | null;
}

export interface PriceParamsJson {
  basePrice: string;
  tierSize: number;
  tierMultBps: number;
  takeoverMultBps: number;
  maxRect: number;
  lotsSold: number;
}

export interface BoardAd {
  id: number;
  address: string;
  owner: string;
  x: number;
  y: number;
  w: number;
  h: number;
  lotsAlive: number;
  hidden: boolean;
  /** Empty when hidden. */
  title: string;
  /** Null when hidden. */
  link: string | null;
  domain: string | null;
  /** Our verified copy, null when hidden or not verified yet. */
  image: string | null;
  createdAt: string;
}

export interface BoardImagesJson {
  version: number;
  x1: string;
  x2: string;
  tiles: string[];
}

export interface BoardResponse {
  params: PriceParamsJson | null;
  images: BoardImagesJson | null;
  ads: BoardAd[];
  /** base64 of a little-endian Uint32Array(10000): ad id per lot (0 = free). */
  lotAds: string;
  /** base64 of a little-endian Uint16Array(10000): index into `prices` per lot. */
  lotPriceIdx: string;
  prices: string[];
}

export interface StatsResponse {
  lotsSold: number;
  totalLots: number;
  freeLotPrice: string;
  tier: number;
  totalLocked: string;
  totalReleased: string;
  lockedNow: string;
  /** The token's total supply (base units), null until the indexer has read it. */
  supply: string | null;
  /** Dollars per whole token (the pump.fun curve, then Jupiter) and when that was read; null until known. */
  tokenUsd: number | null;
  priceAt: string | null;
  takeovers: number;
  paused: boolean;
  nextUnlock: { epoch: number; at: string; amount: string } | null;
  epochs: { epoch: number; amount: string; unlockAt: string; released: boolean; releasedAt: string | null }[];
  launchTs: number | null;
  epochLen: number;
  lockPeriod: number;
}

export interface ActivityItem {
  id: number;
  adId: number;
  buyer: string;
  x: number;
  y: number;
  w: number;
  h: number;
  freeLots: number;
  takenLots: number;
  paidTotal: string;
  title: string;
  domain: string | null;
  hidden: boolean;
  signature: string;
  at: string;
}

export interface LotResponse {
  x: number;
  y: number;
  adId: number;
  lastPrice: string;
  takeoverPrice: string | null;
  freePrice: string | null;
  takeovers: number;
  ad: BoardAd | null;
  history: { adId: number; buyer: string; price: string | null; at: string; signature: string }[];
}

export interface MathExample {
  x: number;
  y: number;
  takeovers: number;
  firstPrice: string;
  currentPrice: string;
  steps: { adId: number; buyer: string; price: string; at: string }[];
}

export interface MeResponse {
  wallet: string;
  ads: (BoardAd & {
    paidTotal: string;
    refundDue: string;
    closed: boolean;
    lotsLost: number;
    canClose: boolean;
    hiddenReason: string | null;
  })[];
  refundDueTotal: string;
}

/** Messages on /api/stream (SSE `data:` lines). */
export type StreamEvent =
  | { type: "hello" | "board" | "refund" | "close" | "release" | "pause" | "price"; board: BoardImagesJson | null; stats: StreamStats | null }
  | { type: "buy"; buy: StreamBuy; board: BoardImagesJson; stats: StreamStats };

export interface StreamStats {
  lotsSold: number;
  takeovers: number;
  totalLocked: string;
  totalReleased: string;
  freeLotPrice: string;
  paused: boolean;
  supply: string | null;
  tokenUsd: number | null;
  priceAt: string | null;
}

export interface StreamBuy {
  adId: number;
  buyer: string;
  x: number;
  y: number;
  w: number;
  h: number;
  freeLots: number;
  takenLots: number;
  paidTotal: string;
  locked: string;
  refunded: string;
  title: string;
  domain: string | null;
  hidden: boolean;
  prior: { adId: number; lots: number }[];
  signature: string;
  at: string;
}
