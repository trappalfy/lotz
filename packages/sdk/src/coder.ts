/**
 * Typed decoding of accounts and events, and encoding of instruction data, over Anchor's Borsh coder.
 * The coder works with the IDL's snake_case names and BN; everything here is exposed as camelCase and bigint.
 */
import { BN, BorshCoder, type Idl } from "@anchor-lang/core";
import { PublicKey } from "@solana/web3.js";
import idlJson from "./idl/lotz.json" with { type: "json" };

export const IDL = idlJson as unknown as Idl;
export const coder = new BorshCoder(IDL);
/** Program id baked into the IDL (the local build). Deployments pass their own. */
export const IDL_PROGRAM_ID = new PublicKey((idlJson as { address: string }).address);

/* eslint-disable @typescript-eslint/no-explicit-any */
type Raw = Record<string, any>;

const big = (v: BN | number | bigint): bigint => (typeof v === "bigint" ? v : BigInt(v.toString()));
const num = (v: BN | number): number => (typeof v === "number" ? v : Number(v.toString()));
const bytes = (v: number[] | Uint8Array): Uint8Array => Uint8Array.from(v);

export interface ConfigAccount {
  admin: PublicKey;
  tokenMint: PublicKey;
  tokenProgram: PublicKey;
  treasury: PublicKey;
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
}

export interface AdAccount {
  adId: number;
  owner: PublicKey;
  nonce: bigint;
  x: number;
  y: number;
  w: number;
  h: number;
  lotsAlive: number;
  refundDue: bigint;
  paidTotal: bigint;
  createdAt: number;
  imageHash: Uint8Array;
  imageUri: string;
  link: string;
  title: string;
}

export interface LockEpochAccount {
  epoch: number;
  amount: bigint;
  unlockAt: number;
  released: boolean;
}

export function decodeConfig(data: Uint8Array): ConfigAccount {
  const r: Raw = coder.accounts.decode("Config", Buffer.from(data));
  return {
    admin: r.admin,
    tokenMint: r.token_mint,
    tokenProgram: r.token_program,
    treasury: r.treasury,
    basePrice: big(r.base_price),
    tierSize: r.tier_size,
    tierMultBps: r.tier_mult_bps,
    takeoverMultBps: r.takeover_mult_bps,
    maxRect: r.max_rect,
    lockPeriod: num(r.lock_period),
    epochLen: num(r.epoch_len),
    launchTs: num(r.launch_ts),
    lotsSold: r.lots_sold,
    takeovers: num(r.takeovers),
    totalLocked: big(r.total_locked),
    totalReleased: big(r.total_released),
    nextAdId: num(r.next_ad_id),
    paused: r.paused,
  };
}

export function decodeAd(data: Uint8Array): AdAccount {
  const r: Raw = coder.accounts.decode("Ad", Buffer.from(data));
  return {
    adId: num(r.ad_id),
    owner: r.owner,
    nonce: big(r.nonce),
    x: r.x,
    y: r.y,
    w: r.w,
    h: r.h,
    lotsAlive: r.lots_alive,
    refundDue: big(r.refund_due),
    paidTotal: big(r.paid_total),
    createdAt: num(r.created_at),
    imageHash: bytes(r.image_hash),
    imageUri: r.image_uri,
    link: r.link,
    title: r.title,
  };
}

export function decodeLockEpoch(data: Uint8Array): LockEpochAccount {
  const r: Raw = coder.accounts.decode("LockEpoch", Buffer.from(data));
  return { epoch: r.epoch, amount: big(r.amount), unlockAt: num(r.unlock_at), released: r.released };
}

/** First 8 bytes of every account of this type (for `getProgramAccounts` memcmp filters). */
export function accountDiscriminator(name: "Config" | "Ad" | "Shard" | "LockEpoch"): Uint8Array {
  const acc = (IDL.accounts ?? []).find((a) => a.name === name);
  if (!acc) throw new Error(`no account ${name} in IDL`);
  return Uint8Array.from(acc.discriminator);
}

// ------------------------------------------------------------------ events

export interface PriorAdHit {
  adId: number;
  lots: number;
  refund: bigint;
}

export interface LotsBoughtEvent {
  name: "LotsBought";
  adId: number;
  ad: PublicKey;
  buyer: PublicKey;
  x: number;
  y: number;
  w: number;
  h: number;
  freeLots: number;
  takenLots: number;
  tier: number;
  freeLotPrice: bigint;
  paidTotal: bigint;
  locked: bigint;
  refunded: bigint;
  epoch: number;
  lotsSold: number;
  prior: PriorAdHit[];
  imageHash: Uint8Array;
  imageUri: string;
  link: string;
  title: string;
  timestamp: number;
}

export interface RefundClaimedEvent {
  name: "RefundClaimed";
  adId: number;
  ad: PublicKey;
  owner: PublicKey;
  amount: bigint;
}

export interface AdClosedEvent {
  name: "AdClosed";
  adId: number;
  ad: PublicKey;
  owner: PublicKey;
}

export interface EpochReleasedEvent {
  name: "EpochReleased";
  epoch: number;
  amount: bigint;
  treasury: PublicKey;
  totalReleased: bigint;
}

export interface PausedSetEvent {
  name: "PausedSet";
  paused: boolean;
}

export interface ConfigInitializedEvent {
  name: "ConfigInitialized";
  admin: PublicKey;
  tokenMint: PublicKey;
  treasury: PublicKey;
  launchTs: number;
}

export type LotzEvent =
  | LotsBoughtEvent
  | RefundClaimedEvent
  | AdClosedEvent
  | EpochReleasedEvent
  | PausedSetEvent
  | ConfigInitializedEvent;

function normalizeEvent(name: string, d: Raw): LotzEvent | null {
  switch (name) {
    case "LotsBought":
      return {
        name,
        adId: num(d.ad_id),
        ad: d.ad,
        buyer: d.buyer,
        x: d.x,
        y: d.y,
        w: d.w,
        h: d.h,
        freeLots: d.free_lots,
        takenLots: d.taken_lots,
        tier: d.tier,
        freeLotPrice: big(d.free_lot_price),
        paidTotal: big(d.paid_total),
        locked: big(d.locked),
        refunded: big(d.refunded),
        epoch: d.epoch,
        lotsSold: d.lots_sold,
        prior: (d.prior as Raw[]).map((p) => ({ adId: num(p.ad_id), lots: p.lots, refund: big(p.refund) })),
        imageHash: bytes(d.image_hash),
        imageUri: d.image_uri,
        link: d.link,
        title: d.title,
        timestamp: num(d.timestamp),
      };
    case "RefundClaimed":
      return { name, adId: num(d.ad_id), ad: d.ad, owner: d.owner, amount: big(d.amount) };
    case "AdClosed":
      return { name, adId: num(d.ad_id), ad: d.ad, owner: d.owner };
    case "EpochReleased":
      return {
        name,
        epoch: d.epoch,
        amount: big(d.amount),
        treasury: d.treasury,
        totalReleased: big(d.total_released),
      };
    case "PausedSet":
      return { name, paused: d.paused };
    case "ConfigInitialized":
      return { name, admin: d.admin, tokenMint: d.token_mint, treasury: d.treasury, launchTs: num(d.launch_ts) };
    default:
      return null;
  }
}

/**
 * Events emitted by `programId` in a transaction's logs. Only `Program data:` lines logged while our program is
 * the innermost running program count, so another program cannot forge our events by logging the same bytes.
 */
export function parseEvents(logs: readonly string[], programId: PublicKey): LotzEvent[] {
  const id = programId.toBase58();
  const stack: string[] = [];
  const out: LotzEvent[] = [];
  for (const line of logs) {
    const invoke = /^Program (\w+) invoke \[\d+\]$/.exec(line);
    if (invoke) {
      stack.push(invoke[1]!);
      continue;
    }
    if (/^Program \w+ (success|failed)/.test(line)) {
      stack.pop();
      continue;
    }
    if (line.startsWith("Program data: ") && stack[stack.length - 1] === id) {
      const decoded = coder.events.decode(line.slice("Program data: ".length));
      if (!decoded) continue;
      const ev = normalizeEvent(decoded.name, decoded.data as Raw);
      if (ev) out.push(ev);
    }
  }
  return out;
}

// ------------------------------------------------------------------ instruction data

export interface BuyArgs {
  nonce: bigint;
  x: number;
  y: number;
  w: number;
  h: number;
  epoch: number;
  maxTotal: bigint;
  imageHash: Uint8Array;
  imageUri: string;
  link: string;
  title: string;
}

export interface InitParams {
  basePrice: bigint;
  tierSize: number;
  tierMultBps: number;
  maxRect: number;
  paused: boolean;
}

const bn = (v: bigint) => new BN(v.toString());

export function encodeBuy(a: BuyArgs): Buffer {
  return coder.instruction.encode("buy", {
    args: {
      nonce: bn(a.nonce),
      x: a.x,
      y: a.y,
      w: a.w,
      h: a.h,
      epoch: a.epoch,
      max_total: bn(a.maxTotal),
      image_hash: Array.from(a.imageHash),
      image_uri: a.imageUri,
      link: a.link,
      title: a.title,
    },
  });
}

export function encodeInitialize(p: InitParams): Buffer {
  return coder.instruction.encode("initialize", {
    params: {
      base_price: bn(p.basePrice),
      tier_size: p.tierSize,
      tier_mult_bps: p.tierMultBps,
      max_rect: p.maxRect,
      paused: p.paused,
    },
  });
}

export const encodeInitShard = (index: number) => coder.instruction.encode("init_shard", { index });
export const encodeClaimRefund = () => coder.instruction.encode("claim_refund", {});
export const encodeCloseAd = () => coder.instruction.encode("close_ad", {});
export const encodeReleaseEpoch = (epoch: number) => coder.instruction.encode("release_epoch", { epoch });
export const encodeSetPaused = (paused: boolean) => coder.instruction.encode("set_paused", { paused });

/** Account names of an instruction, in the order the program expects them. */
export function instructionAccounts(name: string): { name: string; writable: boolean; signer: boolean }[] {
  const ix = IDL.instructions.find((i) => i.name === name);
  if (!ix) throw new Error(`no instruction ${name}`);
  return ix.accounts.map((a) => {
    const acc = a as { name: string; writable?: boolean; signer?: boolean };
    return { name: acc.name, writable: !!acc.writable, signer: !!acc.signer };
  });
}

/** Program error code -> name and message, from the IDL. */
export function programError(code: number): { name: string; msg: string } | undefined {
  const e = (IDL.errors ?? []).find((x) => x.code === code);
  return e ? { name: e.name, msg: e.msg ?? e.name } : undefined;
}
