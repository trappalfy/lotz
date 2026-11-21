/**
 * The indexer core. Applies program events in chain order to Postgres and to the in-memory board, verifies ad
 * images against their on-chain hash, applies the domain block list, re-renders the board and notifies the site.
 * A full reconciliation from account state (shards, ads, epochs, config) runs at start and periodically, so a
 * missed or reordered event can never leave the board wrong for long.
 */
import { PublicKey } from "@solana/web3.js";
import {
  BOARD_SIDE,
  SHARD_COUNT,
  displayTitle,
  applyShard,
  emptyBoard,
  linkDomain,
  lotIndex,
  lotsOf,
  parseEvents,
  takeoverPrice,
  tierOf,
  tierPrice,
  type BoardLots,
  type LotsBoughtEvent,
  type LotzEvent,
} from "@lotz/sdk";
import * as db from "@lotz/db";
import { decodeAdImage, encodeWebp, safeFetch, sha256Hex, MAX_UPLOAD_BYTES, LOT_IMAGE_PX } from "@lotz/imaging";
import { contentTypeOf, IMMUTABLE, type Storage } from "@lotz/storage";
import { BoardRenderer, type LotPaint } from "./renderer";
import { renderOg } from "./og";
import type { Chain } from "./chain";

export interface IndexerOptions {
  chain: Chain;
  pool: db.Pool;
  storage: Storage;
  log?: (msg: string, extra?: Record<string, unknown>) => void;
  /** Tests: fetch external images from localhost over http. */
  allowPrivateImages?: boolean;
  /**
   * Automatic screening of ad images (raw RGBA). Returns true to hide the ad as adult content, null if the check
   * could not run (the ad stays up; moderators can still hide it).
   */
  screen?: (raw: Uint8Array, width: number, height: number) => Promise<boolean | null>;
}

/** What the site's stream receives (kept small: pg_notify payloads are capped at 8 kB). */
export type StreamMessage =
  | { type: "board"; board: db.BoardImages; stats: StreamStats }
  | { type: "buy"; buy: StreamBuy; board: db.BoardImages; stats: StreamStats }
  | { type: "refund" | "close" | "release" | "pause"; board: db.BoardImages; stats: StreamStats };

export interface StreamStats {
  lotsSold: number;
  takeovers: number;
  totalLocked: string;
  totalReleased: string;
  freeLotPrice: string;
  paused: boolean;
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

const MAX_RAW_CACHE_BYTES = 96 * 1024 * 1024;

export class Indexer {
  readonly renderer = new BoardRenderer();
  private board: BoardLots = emptyBoard();
  private ads = new Map<number, db.AdRow>();
  private raw = new Map<number, Buffer>();
  private rawBytes = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private seen = new Set<string>();
  private lastSlot = 0;
  private blocked: string[] = [];
  private images: db.BoardImages | null = null;
  private config: db.ConfigRow | null = null;
  /** While true (backfill), events update the database and the buffer but nothing is published. */
  quiet = false;
  private readonly log: NonNullable<IndexerOptions["log"]>;

  constructor(private o: IndexerOptions) {
    this.log = o.log ?? ((m, e) => console.log(`[indexer] ${m}`, e ?? ""));
  }

  get pool(): db.Pool {
    return this.o.pool;
  }

  /** Runs `fn` after everything queued before it. */
  enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch((e) => this.log("task failed", { error: String(e?.stack ?? e) }));
    return next;
  }

  /** Loads the last known state from the database (before a backfill applies new events on top of it). */
  async load(): Promise<void> {
    this.images = await db.kvGet<db.BoardImages>(this.pool, db.BOARD_IMAGES_KEY);
    this.blocked = (await db.getBlockedDomains(this.pool)).map((d) => d.domain);
    this.config = await db.getConfig(this.pool);
    this.board = (await db.getAllLots(this.pool)).map((l) => ({ adId: l.adId, lastPrice: l.lastPrice }));
    this.ads = new Map((await db.getLiveAds(this.pool)).map((a) => [a.adId, a]));
    this.loaded = true;
  }
  private loaded = false;

  async init(): Promise<void> {
    if (!this.loaded) await this.load();
    await this.reconcile();
    await this.verifyPendingImages();
    await this.repaintAll();
    await this.flush("board");
  }

  // ---------------------------------------------------------------- transactions

  /** Fetches and applies a transaction by signature (from the poller or a webhook). */
  handleSignature(signature: string): Promise<void> {
    return this.enqueue(async () => {
      if (this.seen.has(signature) || (await db.hasSignature(this.pool, signature))) {
        this.seen.add(signature);
        return;
      }
      const tx = await this.o.chain.connection.getTransaction(signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
      if (!tx) throw new Error(`transaction ${signature} not found`);
      this.seen.add(signature);
      if (!tx.meta?.err) {
        const blockTime = tx.blockTime ? new Date(tx.blockTime * 1000) : new Date();
        await this.applyLogs(signature, tx.slot, blockTime, tx.meta?.logMessages ?? []);
      }
      await db.markProcessed(this.pool, [signature]);
    });
  }

  /** Applies logs that arrived over the websocket (no fetch needed). */
  handleLogs(signature: string, slot: number, logs: string[], failed: boolean): Promise<void> {
    return this.enqueue(async () => {
      if (this.seen.has(signature)) return;
      if (failed) {
        this.seen.add(signature);
        await db.markProcessed(this.pool, [signature]);
        return;
      }
      if (await db.hasSignature(this.pool, signature)) {
        this.seen.add(signature);
        return;
      }
      this.seen.add(signature);
      await this.applyLogs(signature, slot, new Date(), logs);
      await db.markProcessed(this.pool, [signature]);
    });
  }

  private async applyLogs(signature: string, slot: number, blockTime: Date, logs: string[]): Promise<void> {
    const events = parseEvents(logs, this.o.chain.programId);
    if (logs.some((l) => l === "Log truncated")) {
      // Another instruction filled the log buffer and our event may be gone: take the state from the accounts.
      this.log("truncated logs: reconciling from accounts", { signature });
      await this.reconcile();
      await this.verifyPendingImages();
      await this.repaintAll();
      if (!this.quiet) await this.flush("board");
      if (events.length === 0) return;
    }
    if (events.length === 0) return;
    if (slot < this.lastSlot) {
      // Out of order: apply the events for history, then take ownership and prices from the chain.
      this.log("out-of-order transaction, reconciling", { signature, slot, lastSlot: this.lastSlot });
    }
    const outOfOrder = slot < this.lastSlot;
    this.lastSlot = Math.max(this.lastSlot, slot);
    if (this.seen.size > 50_000) this.seen.clear();

    let kind: "buy" | "refund" | "close" | "release" | "pause" = "pause";
    let buy: StreamBuy | null = null;
    for (const [i, ev] of events.entries()) {
      const time = ev.name === "LotsBought" ? new Date(ev.timestamp * 1000) : blockTime;
      const id = await db.insertEvent(this.pool, {
        signature,
        eventIndex: i,
        slot,
        blockTime: time,
        name: ev.name,
        adId: "adId" in ev ? ev.adId : null,
        actor: actorOf(ev),
        rect: ev.name === "LotsBought" ? { x: ev.x, y: ev.y, w: ev.w, h: ev.h } : undefined,
        data: serializeEvent(ev),
      });
      if (id === null) continue; // already stored
      switch (ev.name) {
        case "LotsBought":
          buy = await this.applyBuy(ev, signature, slot, time, outOfOrder);
          kind = "buy";
          break;
        case "RefundClaimed": {
          const ad = this.ads.get(ev.adId) ?? (await db.getAd(this.pool, ev.adId));
          if (ad) {
            const refundDue = ad.refundDue > ev.amount ? ad.refundDue - ev.amount : 0n;
            await db.updateAdState(this.pool, ev.adId, { lotsAlive: ad.lotsAlive, refundDue, closed: ad.closed });
            if (this.ads.has(ev.adId)) this.ads.set(ev.adId, { ...ad, refundDue });
          }
          kind = "refund";
          break;
        }
        case "AdClosed":
          await db.updateAdState(this.pool, ev.adId, { lotsAlive: 0, refundDue: 0n, closed: true });
          this.ads.delete(ev.adId);
          kind = "close";
          break;
        case "EpochReleased":
          await db.markEpochReleased(this.pool, ev.epoch, time, signature);
          kind = "release";
          break;
        default:
          break;
      }
    }
    await this.refreshConfig();
    await this.refreshEpochs();
    if (outOfOrder) await this.reconcileShards();
    if (!this.quiet) await this.flush(kind, buy);
  }

  private async applyBuy(
    ev: LotsBoughtEvent,
    signature: string,
    slot: number,
    at: Date,
    outOfOrder: boolean,
  ): Promise<StreamBuy> {
    const domain = linkDomain(ev.link);
    const row: db.NewAd = {
      adId: ev.adId,
      address: ev.ad.toBase58(),
      owner: ev.buyer.toBase58(),
      nonce: 0n,
      x: ev.x,
      y: ev.y,
      w: ev.w,
      h: ev.h,
      imageHash: Buffer.from(ev.imageHash).toString("hex"),
      imageUri: ev.imageUri,
      link: ev.link,
      linkDomain: domain,
      title: ev.title,
      paidTotal: ev.paidTotal,
      lotsAlive: ev.w * ev.h,
      createdAt: at,
      createdSlot: slot,
      signature,
    };
    // the nonce is not in the event; read it from the account when we can
    const account = (await this.o.chain.ads([ev.ad])).get(ev.ad.toBase58());
    if (account) row.nonce = account.nonce;
    await db.insertAd(this.pool, row);

    // lots: same rules as the program, applied to our mirror in order
    const free: number[] = [];
    const taken: number[] = [];
    const updates: { lot: number; adId: number; lastPrice: bigint }[] = [];
    const mult = this.config?.takeoverMultBps ?? 15_000;
    for (const [lx, ly] of lotsOf(ev)) {
      const i = lotIndex(lx, ly);
      const cur = this.board[i]!;
      let price: bigint;
      if (cur.adId === 0) {
        free.push(i);
        price = ev.freeLotPrice;
      } else if (cur.adId === ev.adId) {
        price = cur.lastPrice; // already applied by a reconciliation
      } else {
        taken.push(i);
        price = takeoverPrice(cur.lastPrice, mult);
      }
      this.board[i] = { adId: ev.adId, lastPrice: price };
      updates.push({ lot: i, adId: ev.adId, lastPrice: price });
    }
    if (!outOfOrder) await db.setLots(this.pool, updates);
    await db.recordLotHistory(this.pool, free, ev.freeLotPrice, at, taken);

    // previous ads: fewer live lots, refunds due
    for (const hit of ev.prior) {
      const prev = this.ads.get(hit.adId) ?? (await db.getAd(this.pool, hit.adId));
      if (!prev) continue;
      const next = { lotsAlive: Math.max(0, prev.lotsAlive - hit.lots), refundDue: prev.refundDue + hit.refund, closed: prev.closed };
      await db.updateAdState(this.pool, hit.adId, next);
      if (next.lotsAlive > 0) this.ads.set(hit.adId, { ...prev, ...next });
      else this.ads.delete(hit.adId);
    }

    // moderation and image check, then paint
    let ad = (await db.getAd(this.pool, ev.adId))!;
    ad = await this.applyBlocklist(ad);
    ad = await this.verifyImage(ad);
    this.ads.set(ad.adId, ad);
    this.paintAd(ad);

    return {
      adId: ev.adId,
      buyer: row.owner,
      x: ev.x,
      y: ev.y,
      w: ev.w,
      h: ev.h,
      freeLots: ev.freeLots,
      takenLots: ev.takenLots,
      paidTotal: ev.paidTotal.toString(),
      locked: ev.locked.toString(),
      refunded: ev.refunded.toString(),
      title: ad.hidden ? "" : displayTitle(ev.title),
      domain: ad.hidden ? null : domain,
      hidden: ad.hidden || ad.imageStatus !== "ok",
      prior: ev.prior.map((p) => ({ adId: p.adId, lots: p.lots })),
      signature,
      at: at.toISOString(),
    };
  }

  // ---------------------------------------------------------------- moderation and images

  private domainBlocked(domain: string | null): boolean {
    if (!domain) return false;
    return this.blocked.some((b) => domain === b || domain.endsWith(`.${b}`));
  }

  private async applyBlocklist(ad: db.AdRow): Promise<db.AdRow> {
    if (!ad.hidden && this.domainBlocked(ad.linkDomain)) {
      await db.setHidden(this.pool, ad.adId, true, "blocked_domain", "blocklist");
      return { ...ad, hidden: true, hiddenReason: "blocked_domain", hiddenAt: new Date() };
    }
    return ad;
  }

  /** Fetches the image, checks sha256 against the on-chain hash, stores our normalized copy. */
  async verifyImage(ad: db.AdRow): Promise<db.AdRow> {
    if (ad.imageStatus === "ok" || ad.imageStatus === "mismatch") return ad;
    const ours = this.o.storage.keyOf(ad.imageUri);
    let bytes: Uint8Array | null = null;
    let error: string | null = null;
    try {
      bytes = ours
        ? await this.o.storage.get(ours)
        : await safeFetch(ad.imageUri, {
            maxBytes: MAX_UPLOAD_BYTES,
            timeoutMs: 10_000,
            allowPrivate: this.o.allowPrivateImages,
          });
      if (!bytes) error = "image not found in storage";
    } catch (e) {
      error = `fetch failed: ${String((e as Error).message ?? e)}`;
    }
    if (!bytes) {
      await db.setAdImage(this.pool, ad.adId, "error", null, error);
      await db.setHidden(this.pool, ad.adId, true, "bad_image", "indexer");
      return { ...ad, imageStatus: "error", imageError: error, hidden: true, hiddenReason: "bad_image" };
    }
    if (sha256Hex(bytes) !== ad.imageHash) {
      this.log("image hash mismatch: hiding", { adId: ad.adId });
      await db.setAdImage(this.pool, ad.adId, "mismatch", null, "sha256 does not match image_hash");
      await db.setHidden(this.pool, ad.adId, true, "hash_mismatch", "indexer");
      return { ...ad, imageStatus: "mismatch", hidden: true, hiddenReason: "hash_mismatch" };
    }
    try {
      const raw = await decodeAdImage(bytes, ad.w, ad.h);
      this.cacheRaw(ad.adId, raw);
      let key = ours;
      if (!key || !(await this.isNormalized(bytes, ad))) {
        key = `ads/${ad.adId}-${ad.imageHash.slice(0, 16)}.webp`;
        await this.o.storage.put(key, await encodeWebp(raw, ad.w * LOT_IMAGE_PX, ad.h * LOT_IMAGE_PX), contentTypeOf(key), IMMUTABLE);
      }
      await db.setAdImage(this.pool, ad.adId, "ok", key, null);
      const checked: db.AdRow = { ...ad, imageStatus: "ok", imageKey: key, imageError: null };
      // runs once per image (an "ok" image is not checked again), so a moderator's unhide sticks
      if (!ad.hidden && this.o.screen) {
        const flagged = await this.o.screen(raw, ad.w * LOT_IMAGE_PX, ad.h * LOT_IMAGE_PX).catch(() => null);
        if (flagged) {
          this.log("image flagged as adult content: hiding", { adId: ad.adId });
          await db.setHidden(this.pool, ad.adId, true, "nsfw", "indexer");
          return { ...checked, hidden: true, hiddenReason: "nsfw" };
        }
      }
      return checked;
    } catch (e) {
      const msg = `decode failed: ${String((e as Error).message ?? e)}`;
      await db.setAdImage(this.pool, ad.adId, "error", null, msg);
      await db.setHidden(this.pool, ad.adId, true, "bad_image", "indexer");
      return { ...ad, imageStatus: "error", imageError: msg, hidden: true, hiddenReason: "bad_image" };
    }
  }

  private async isNormalized(bytes: Uint8Array, ad: db.AdRow): Promise<boolean> {
    const { default: sharp } = await import("sharp");
    const m = await sharp(bytes).metadata();
    return m.format === "webp" && m.width === ad.w * LOT_IMAGE_PX && m.height === ad.h * LOT_IMAGE_PX;
  }

  private async verifyPendingImages(): Promise<void> {
    for (const ad of this.ads.values()) {
      if (ad.imageStatus === "pending" || ad.imageStatus === "error") {
        const checked = await this.verifyImage(await this.applyBlocklist(ad));
        this.ads.set(ad.adId, checked);
      }
    }
  }

  /** After the web app changed moderation: reload the block list and the given ads, repaint them. */
  onModeration(adIds: number[]): Promise<void> {
    return this.enqueue(async () => {
      this.blocked = (await db.getBlockedDomains(this.pool)).map((d) => d.domain);
      const rows = await db.getAdsByIds(this.pool, adIds);
      for (const ad of rows) {
        if (ad.lotsAlive === 0 || ad.closed) continue;
        let next = await this.applyBlocklist(ad);
        if (!next.hidden && next.imageStatus !== "ok") next = await this.verifyImage(next);
        this.ads.set(ad.adId, next);
        this.paintAd(next);
      }
      await this.flush("board");
    });
  }

  // ---------------------------------------------------------------- painting

  private cacheRaw(adId: number, raw: Buffer): void {
    if (this.raw.has(adId)) return;
    this.raw.set(adId, raw);
    this.rawBytes += raw.length;
    while (this.rawBytes > MAX_RAW_CACHE_BYTES && this.raw.size > 1) {
      const [oldest, buf] = this.raw.entries().next().value as [number, Buffer];
      this.raw.delete(oldest);
      this.rawBytes -= buf.length;
    }
  }

  private async rawOf(ad: db.AdRow): Promise<Buffer | null> {
    const cached = this.raw.get(ad.adId);
    if (cached) return cached;
    if (!ad.imageKey) return null;
    const bytes = await this.o.storage.get(ad.imageKey);
    if (!bytes) return null;
    const raw = await decodeAdImage(bytes, ad.w, ad.h);
    this.cacheRaw(ad.adId, raw);
    return raw;
  }

  private paintFor(ad: db.AdRow | undefined, raw: Buffer | null): LotPaint {
    if (!ad) return { kind: "hidden" };
    if (ad.hidden || ad.imageStatus !== "ok" || !raw) return { kind: "hidden" };
    return { kind: "image", raw, adX: ad.x, adY: ad.y, adW: ad.w };
  }

  /** Paints the lots this ad still holds. */
  private paintAd(ad: db.AdRow): void {
    const raw = this.raw.get(ad.adId) ?? null;
    for (const [lx, ly] of lotsOf(ad)) {
      if (this.board[lotIndex(lx, ly)]!.adId === ad.adId) this.renderer.paint(lx, ly, this.paintFor(ad, raw));
    }
  }

  async repaintAll(): Promise<void> {
    const raws = new Map<number, Buffer | null>();
    for (const ad of this.ads.values()) {
      raws.set(ad.adId, ad.hidden || ad.imageStatus !== "ok" ? null : await this.rawOf(ad).catch(() => null));
    }
    for (let ly = 0; ly < BOARD_SIDE; ly++) {
      for (let lx = 0; lx < BOARD_SIDE; lx++) {
        const lot = this.board[lotIndex(lx, ly)]!;
        if (lot.adId === 0) this.renderer.paint(lx, ly, { kind: "free" });
        else this.renderer.paint(lx, ly, this.paintFor(this.ads.get(lot.adId), raws.get(lot.adId) ?? null));
      }
    }
    this.renderer.markAllDirty();
  }

  /** Publishes the board if anything changed, then notifies the stream. */
  private async flush(kind: StreamMessage["type"], buy: StreamBuy | null = null): Promise<void> {
    if (this.renderer.hasDirty() || !this.images) {
      this.images = await this.renderer.publish(this.o.storage, this.images);
      await db.kvSet(this.pool, db.BOARD_IMAGES_KEY, this.images);
    }
    const stats = this.stats();
    const msg: StreamMessage =
      kind === "buy" && buy ? { type: "buy", buy, board: this.images, stats } : { type: kind === "buy" ? "board" : kind, board: this.images, stats } as StreamMessage;
    await db.notify(this.pool, db.STREAM_CHANNEL, msg);
    for (const l of this.subscribers) {
      try {
        l(msg);
      } catch {
        /* a closed client; it unsubscribes itself */
      }
    }
  }

  private subscribers = new Set<(msg: StreamMessage) => void>();

  /** Every published stream message, in process (the indexer's own /stream endpoint). */
  subscribe(fn: (msg: StreamMessage) => void): () => void {
    this.subscribers.add(fn);
    return () => {
      this.subscribers.delete(fn);
    };
  }

  /** The current board images and counters, for a client that just connected. */
  snapshot(): { board: db.BoardImages | null; stats: StreamStats } {
    return { board: this.images ?? null, stats: this.stats() };
  }

  private stats(): StreamStats {
    const c = this.config;
    const free = c ? tierPrice(c.basePrice, c.tierMultBps, tierOf(c.lotsSold, c.tierSize)) : 0n;
    return {
      lotsSold: c?.lotsSold ?? 0,
      takeovers: c?.takeovers ?? 0,
      totalLocked: (c?.totalLocked ?? 0n).toString(),
      totalReleased: (c?.totalReleased ?? 0n).toString(),
      freeLotPrice: free.toString(),
      paused: c?.paused ?? false,
    };
  }

  /** Renders the OG card from the current 1x board. */
  async renderOg(): Promise<void> {
    await this.enqueue(async () => {
      const board = this.images ? await this.o.storage.get(this.images.x1) : null;
      const png = await renderOg(board);
      const key = `og/og-${Date.now()}.png`;
      await this.o.storage.put(key, png, "image/png", IMMUTABLE);
      await this.o.storage.put("og/latest.png", png, "image/png", "public, max-age=3600");
      if (this.images) {
        this.images = { ...this.images, og: key };
        await db.kvSet(this.pool, db.BOARD_IMAGES_KEY, this.images);
      }
    });
  }

  // ---------------------------------------------------------------- reconciliation

  async refreshConfig(): Promise<void> {
    const chain = this.o.chain;
    const c = await chain.config();
    if (!c) return;
    const decimals = this.config?.tokenMint === c.tokenMint.toBase58() ? this.config.tokenDecimals : await chain.mintDecimals(c.tokenMint);
    const row: Omit<db.ConfigRow, "updatedAt"> = {
      programId: chain.programId.toBase58(),
      admin: c.admin.toBase58(),
      tokenMint: c.tokenMint.toBase58(),
      tokenProgram: c.tokenProgram.toBase58(),
      tokenDecimals: decimals,
      treasury: c.treasury.toBase58(),
      basePrice: c.basePrice,
      tierSize: c.tierSize,
      tierMultBps: c.tierMultBps,
      takeoverMultBps: c.takeoverMultBps,
      maxRect: c.maxRect,
      lockPeriod: c.lockPeriod,
      epochLen: c.epochLen,
      launchTs: c.launchTs,
      lotsSold: c.lotsSold,
      takeovers: c.takeovers,
      totalLocked: c.totalLocked,
      totalReleased: c.totalReleased,
      nextAdId: c.nextAdId,
      paused: c.paused,
      upgradeAuthority: await chain.upgradeAuthority(),
      lockVault: chain.pdas.lockVault().toBase58(),
      refundVault: chain.pdas.refundVault().toBase58(),
    };
    await db.upsertConfig(this.pool, row);
    this.config = { ...row, updatedAt: new Date() };
  }

  async refreshEpochs(): Promise<void> {
    for (const { address, epoch } of await this.o.chain.allEpochs()) {
      await db.upsertEpoch(this.pool, {
        epoch: epoch.epoch,
        address,
        amount: epoch.amount,
        unlockAt: new Date(epoch.unlockAt * 1000),
        released: epoch.released,
      });
    }
  }

  private async reconcileShards(): Promise<void> {
    const shards = await this.o.chain.shards(Array.from({ length: SHARD_COUNT }, (_, i) => i));
    const next = emptyBoard();
    for (const [index, lots] of shards) applyShard(next, { index, lots });
    const changed: { lot: number; adId: number; lastPrice: bigint }[] = [];
    next.forEach((l, i) => {
      const cur = this.board[i]!;
      if (cur.adId !== l.adId || cur.lastPrice !== l.lastPrice) changed.push({ lot: i, adId: l.adId, lastPrice: l.lastPrice });
    });
    await db.setLots(this.pool, changed);
    for (const ch of changed) {
      const lx = ch.lot % BOARD_SIDE;
      const ly = Math.floor(ch.lot / BOARD_SIDE);
      this.board[ch.lot] = { adId: ch.adId, lastPrice: ch.lastPrice };
      if (ch.adId === 0) this.renderer.paint(lx, ly, { kind: "free" });
      else {
        const ad = this.ads.get(ch.adId);
        this.renderer.paint(lx, ly, this.paintFor(ad, ad ? await this.rawOf(ad).catch(() => null) : null));
      }
    }
    if (changed.length) this.log("shards reconciled", { changed: changed.length });
  }

  /** Full sync from account state. */
  async reconcile(): Promise<void> {
    await this.refreshConfig();
    await this.refreshEpochs();
    // ads: insert any we never saw an event for, update counters, mark vanished ones closed
    const onChain = await this.o.chain.allAds();
    const seen = new Set<number>();
    for (const { address, ad } of onChain) {
      seen.add(ad.adId);
      await db.insertAd(this.pool, {
        adId: ad.adId,
        address,
        owner: ad.owner.toBase58(),
        nonce: ad.nonce,
        x: ad.x,
        y: ad.y,
        w: ad.w,
        h: ad.h,
        imageHash: Buffer.from(ad.imageHash).toString("hex"),
        imageUri: ad.imageUri,
        link: ad.link,
        linkDomain: linkDomain(ad.link),
        title: ad.title,
        paidTotal: ad.paidTotal,
        lotsAlive: ad.lotsAlive,
        createdAt: new Date(ad.createdAt * 1000),
        createdSlot: null,
        signature: null,
      });
      await db.updateAdState(this.pool, ad.adId, { lotsAlive: ad.lotsAlive, refundDue: ad.refundDue, closed: false });
    }
    for (const ad of await db.getAllOpenAds(this.pool)) {
      if (!seen.has(ad.adId)) await db.updateAdState(this.pool, ad.adId, { lotsAlive: 0, refundDue: 0n, closed: true });
    }
    this.ads = new Map((await db.getLiveAds(this.pool)).map((a) => [a.adId, a]));
    // lots: the shards are the truth
    const lots = await db.getAllLots(this.pool);
    this.board = lots.map((l) => ({ adId: l.adId, lastPrice: l.lastPrice }));
    await this.reconcileShards();
  }

  /** Periodic light reconciliation (config, epochs, shards). */
  periodic(): Promise<void> {
    return this.enqueue(async () => {
      await this.refreshConfig();
      await this.refreshEpochs();
      await this.reconcileShards();
      if (this.renderer.hasDirty()) await this.flush("board");
    });
  }

  fullReconcile(): Promise<void> {
    return this.enqueue(async () => {
      await this.reconcile();
      await this.verifyPendingImages();
      await this.repaintAll();
      await this.flush("board");
    });
  }

  boardSnapshot(): BoardLots {
    return this.board;
  }
}

function actorOf(ev: LotzEvent): string | null {
  switch (ev.name) {
    case "LotsBought":
      return ev.buyer.toBase58();
    case "RefundClaimed":
    case "AdClosed":
      return ev.owner.toBase58();
    case "EpochReleased":
      return ev.treasury.toBase58();
    default:
      return null;
  }
}

/** JSON-safe copy of an event (bigint -> string, PublicKey -> base58, bytes -> hex). */
export function serializeEvent(ev: LotzEvent): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ev)) out[k] = jsonValue(v);
  return out;
}

function jsonValue(v: unknown): unknown {
  if (typeof v === "bigint") return v.toString();
  if (v instanceof PublicKey) return v.toBase58();
  if (v instanceof Uint8Array) return Buffer.from(v).toString("hex");
  if (Array.isArray(v)) return v.map(jsonValue);
  if (v && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) o[k] = jsonValue(x);
    return o;
  }
  return v;
}
