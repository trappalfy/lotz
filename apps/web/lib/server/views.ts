import "server-only";
import * as db from "@lotz/db";
import { BOARD_SIDE, TOTAL_LOTS, displayTitle, linkDomain, takeoverPrice, tierOf, tierPrice } from "@lotz/sdk";
import type {
  ActivityItem,
  BoardAd,
  BoardImagesJson,
  BoardResponse,
  DeploymentInfo,
  LotResponse,
  MathExample,
  MeResponse,
  StatsResponse,
} from "../api-types";
import { pool } from "./db";
import { env } from "./env";
import { storage } from "./storage";

export function boardAd(a: db.AdRow): BoardAd {
  const visible = !a.hidden && a.imageStatus === "ok";
  return {
    id: a.adId,
    address: a.address,
    owner: a.owner,
    x: a.x,
    y: a.y,
    w: a.w,
    h: a.h,
    lotsAlive: a.lotsAlive,
    hidden: !visible,
    title: visible ? displayTitle(a.title) : "",
    link: visible ? a.link : null,
    domain: visible ? (a.linkDomain ?? linkDomain(a.link)) : null,
    image: visible && a.imageKey ? storage().publicUrl(a.imageKey) : null,
    createdAt: a.createdAt.toISOString(),
  };
}

export function imagesJson(i: db.BoardImages | null): BoardImagesJson | null {
  if (!i) return null;
  const s = storage();
  return { version: i.version, x1: s.publicUrl(i.x1), x2: s.publicUrl(i.x2), tiles: i.tiles.map((k) => s.publicUrl(k)) };
}

export async function deploymentInfo(origin: string): Promise<DeploymentInfo> {
  const c = await db.getConfig(pool());
  return {
    cluster: env.cluster(),
    programId: env.programId(),
    tokenMint: c?.tokenMint ?? null,
    tokenProgram: c?.tokenProgram ?? null,
    tokenDecimals: c?.tokenDecimals ?? 6,
    treasury: c?.treasury ?? null,
    lockVault: c?.lockVault ?? null,
    refundVault: c?.refundVault ?? null,
    lookupTable: env.lookupTable(),
    upgradeAuthority: c?.upgradeAuthority ?? null,
    initialized: !!c,
    rpcUrl: process.env.NEXT_PUBLIC_RPC_URL || `${origin}/api/rpc`,
    streamUrl: env.streamUrl() || `${origin}/api/stream`,
    priorityMicroLamports: env.priorityMicroLamports(),
    xUrl: env.xUrl(),
    sourceUrl: env.sourceUrl(),
  };
}

let boardCache: { version: number; at: number; value: Promise<BoardResponse> } | null = null;

/**
 * The board, cached per render version (the indexer bumps it after writing each change), so the burst of
 * refetches after a purchase costs one computation.
 */
export async function boardView(): Promise<BoardResponse> {
  const images = await db.kvGet<db.BoardImages>(pool(), db.BOARD_IMAGES_KEY);
  const version = images?.version ?? 0;
  const now = Date.now();
  if (boardCache && boardCache.version === version && now - boardCache.at < 10_000) return boardCache.value;
  const value = computeBoardView();
  boardCache = { version, at: now, value };
  value.catch(() => {
    if (boardCache?.value === value) boardCache = null;
  });
  return value;
}

async function computeBoardView(): Promise<BoardResponse> {
  const p = pool();
  const [config, ads, lots, images] = await Promise.all([
    db.getConfig(p),
    db.getLiveAds(p),
    db.getAllLots(p),
    db.kvGet<db.BoardImages>(p, db.BOARD_IMAGES_KEY),
  ]);
  const adIds = new Uint32Array(TOTAL_LOTS);
  const priceIdx = new Uint16Array(TOTAL_LOTS);
  const prices: string[] = [];
  const index = new Map<string, number>();
  for (const l of lots) {
    adIds[l.lot] = l.adId;
    const key = l.lastPrice.toString();
    let i = index.get(key);
    if (i === undefined) {
      i = prices.length;
      prices.push(key);
      index.set(key, i);
    }
    priceIdx[l.lot] = i;
  }
  return {
    params: config
      ? {
          basePrice: config.basePrice.toString(),
          tierSize: config.tierSize,
          tierMultBps: config.tierMultBps,
          takeoverMultBps: config.takeoverMultBps,
          maxRect: config.maxRect,
          lotsSold: config.lotsSold,
        }
      : null,
    images: imagesJson(images),
    ads: ads.map(boardAd),
    lotAds: Buffer.from(adIds.buffer).toString("base64"),
    lotPriceIdx: Buffer.from(priceIdx.buffer).toString("base64"),
    prices,
  };
}

export async function statsView(): Promise<StatsResponse> {
  const p = pool();
  const [c, epochs, supply] = await Promise.all([
    db.getConfig(p),
    db.getEpochs(p),
    db.kvGet<db.TokenSupply>(p, db.TOKEN_SUPPLY_KEY),
  ]);
  const tier = c ? tierOf(c.lotsSold, c.tierSize) : 0;
  const free = c ? tierPrice(c.basePrice, c.tierMultBps, tier) : 0n;
  const pending = epochs.filter((e) => !e.released).sort((a, b) => a.unlockAt.getTime() - b.unlockAt.getTime());
  const next = pending[0];
  return {
    lotsSold: c?.lotsSold ?? 0,
    totalLots: TOTAL_LOTS,
    freeLotPrice: free.toString(),
    tier,
    totalLocked: (c?.totalLocked ?? 0n).toString(),
    totalReleased: (c?.totalReleased ?? 0n).toString(),
    lockedNow: ((c?.totalLocked ?? 0n) - (c?.totalReleased ?? 0n)).toString(),
    supply: supply?.amount ?? null,
    takeovers: c?.takeovers ?? 0,
    paused: c?.paused ?? false,
    nextUnlock: next ? { epoch: next.epoch, at: next.unlockAt.toISOString(), amount: next.amount.toString() } : null,
    epochs: epochs.map((e) => ({
      epoch: e.epoch,
      amount: e.amount.toString(),
      unlockAt: e.unlockAt.toISOString(),
      released: e.released,
      releasedAt: e.releasedAt?.toISOString() ?? null,
    })),
    launchTs: c?.launchTs ?? null,
    epochLen: c?.epochLen ?? 7 * 86_400,
    lockPeriod: c?.lockPeriod ?? 365 * 86_400,
  };
}

function activityItem(e: db.EventRow, ads: Map<number, db.AdRow>): ActivityItem {
  const d = e.data as Record<string, string | number>;
  const ad = e.adId != null ? ads.get(e.adId) : undefined;
  const visible = !!ad && !ad.hidden && ad.imageStatus === "ok";
  return {
    id: e.id,
    adId: Number(d.adId),
    buyer: String(d.buyer),
    x: Number(d.x),
    y: Number(d.y),
    w: Number(d.w),
    h: Number(d.h),
    freeLots: Number(d.freeLots),
    takenLots: Number(d.takenLots),
    paidTotal: String(d.paidTotal),
    title: visible ? displayTitle(String(d.title)) : "",
    domain: visible ? linkDomain(String(d.link)) : null,
    hidden: !visible,
    signature: e.signature,
    at: e.blockTime.toISOString(),
  };
}

export async function activityView(limit: number, before?: number): Promise<ActivityItem[]> {
  const p = pool();
  const events = await db.getActivity(p, limit, before);
  const ads = new Map((await db.getAdsByIds(p, events.map((e) => e.adId!).filter(Boolean))).map((a) => [a.adId, a]));
  return events.map((e) => activityItem(e, ads));
}

export async function lotView(lx: number, ly: number): Promise<LotResponse> {
  const p = pool();
  const lot = await db.getLot(p, ly * BOARD_SIDE + lx);
  const c = await db.getConfig(p);
  const adId = lot?.adId ?? 0;
  const ad = adId ? await db.getAd(p, adId) : null;
  const history = await db.getLotHistory(p, lx, ly);
  const mult = c?.takeoverMultBps ?? 15_000;
  return {
    x: lx,
    y: ly,
    adId,
    lastPrice: (lot?.lastPrice ?? 0n).toString(),
    takeoverPrice: adId ? takeoverPrice(lot!.lastPrice, mult).toString() : null,
    freePrice: !adId && c ? tierPrice(c.basePrice, c.tierMultBps, tierOf(c.lotsSold, c.tierSize)).toString() : null,
    takeovers: lot?.takeovers ?? 0,
    ad: ad ? boardAd(ad) : null,
    history: history.map((e) => ({
      adId: Number(e.adId),
      buyer: e.actor ?? "",
      price: null,
      at: e.blockTime.toISOString(),
      signature: e.signature,
    })),
  };
}

/** The lot with the longest takeover history, with the price at each step (brief §5.3 "The math"). */
export async function mathView(): Promise<MathExample | null> {
  const p = pool();
  const lot = await db.getMostTakenLot(p);
  if (!lot || lot.firstPrice == null) return null;
  const c = await db.getConfig(p);
  const lx = lot.lot % BOARD_SIDE;
  const ly = Math.floor(lot.lot / BOARD_SIDE);
  const history = await db.getLotHistory(p, lx, ly);
  const mult = c?.takeoverMultBps ?? 15_000;
  let price = lot.firstPrice;
  const steps = history.map((e, i) => {
    if (i > 0) price = takeoverPrice(price, mult);
    return { adId: Number(e.adId), buyer: e.actor ?? "", price: price.toString(), at: e.blockTime.toISOString() };
  });
  return {
    x: lx,
    y: ly,
    takeovers: lot.takeovers,
    firstPrice: lot.firstPrice.toString(),
    currentPrice: lot.lastPrice.toString(),
    steps,
  };
}

export async function meView(wallet: string): Promise<MeResponse> {
  const ads = await db.getAdsByOwner(pool(), wallet);
  let total = 0n;
  return {
    wallet,
    ads: ads.map((a) => {
      total += a.refundDue;
      const view = boardAd(a);
      return {
        ...view,
        // the owner sees their own content even if the site hides it
        title: displayTitle(a.title),
        link: a.link,
        domain: a.linkDomain,
        paidTotal: a.paidTotal.toString(),
        refundDue: a.refundDue.toString(),
        closed: a.closed,
        lotsLost: a.w * a.h - a.lotsAlive,
        canClose: !a.closed && a.lotsAlive === 0 && a.refundDue === 0n,
        hiddenReason: a.hidden ? a.hiddenReason : a.imageStatus === "ok" ? null : a.imageStatus,
      };
    }),
    refundDueTotal: total.toString(),
  };
}
