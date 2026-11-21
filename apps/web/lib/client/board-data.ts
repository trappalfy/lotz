import { BOARD_SIDE, TOTAL_LOTS, lotIndex, takeoverPrice, tierOf, tierPrice, type BoardLots, type PriceParams } from "@lotz/sdk";
import type { BoardAd, BoardImagesJson, BoardResponse } from "../api-types";

function b64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** The board as the API describes it: owner ad and last price per lot, live ads, image URLs. */
export class BoardData {
  readonly adIds: Uint32Array;
  readonly priceIdx: Uint16Array;
  readonly prices: bigint[];
  readonly ads: Map<number, BoardAd>;
  readonly params: PriceParams & { maxRect: number } | null;
  readonly images: BoardImagesJson | null;

  constructor(r: BoardResponse) {
    const ids = b64(r.lotAds);
    const idx = b64(r.lotPriceIdx);
    this.adIds = new Uint32Array(ids.buffer, ids.byteOffset, TOTAL_LOTS);
    this.priceIdx = new Uint16Array(idx.buffer, idx.byteOffset, TOTAL_LOTS);
    this.prices = r.prices.map((p) => BigInt(p));
    this.ads = new Map(r.ads.map((a) => [a.id, a]));
    this.params = r.params
      ? {
          basePrice: BigInt(r.params.basePrice),
          tierSize: r.params.tierSize,
          tierMultBps: r.params.tierMultBps,
          takeoverMultBps: r.params.takeoverMultBps,
          lotsSold: r.params.lotsSold,
          maxRect: r.params.maxRect,
        }
      : null;
    this.images = r.images;
  }

  adAt(lx: number, ly: number): BoardAd | null {
    if (lx < 0 || ly < 0 || lx >= BOARD_SIDE || ly >= BOARD_SIDE) return null;
    const id = this.adIds[lotIndex(lx, ly)]!;
    return id ? (this.ads.get(id) ?? null) : null;
  }

  lastPrice(lx: number, ly: number): bigint {
    return this.prices[this.priceIdx[lotIndex(lx, ly)]!] ?? 0n;
  }

  /** What one lot costs now: the tier price if free, 1.5x its last price if taken. */
  lotPrice(lx: number, ly: number): bigint | null {
    if (!this.params) return null;
    const id = this.adIds[lotIndex(lx, ly)]!;
    if (id === 0) return tierPrice(this.params.basePrice, this.params.tierMultBps, tierOf(this.params.lotsSold, this.params.tierSize));
    return takeoverPrice(this.lastPrice(lx, ly), this.params.takeoverMultBps);
  }

  toLots(): BoardLots {
    return Array.from({ length: TOTAL_LOTS }, (_, i) => ({ adId: this.adIds[i]!, lastPrice: this.prices[this.priceIdx[i]!] ?? 0n }));
  }
}
