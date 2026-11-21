/**
 * Prices, exactly as the program computes them (programs/lotz/src/math.rs). All token amounts are bigint base
 * units. Keep in sync with the Rust; `test/math.test.ts` pins the same values as the Rust unit tests.
 */
import { BPS, TAKEOVER_MULT_BPS } from "./constants";

/** `floor(lots_sold / tier_size)`. */
export function tierOf(lotsSold: number, tierSize: number): number {
  return Math.floor(lotsSold / tierSize);
}

/** Free-lot price at `tier`: `base * (mult/10_000)^tier`, floored after every step. */
export function tierPrice(basePrice: bigint, tierMultBps: number, tier: number): bigint {
  let price = basePrice;
  const mult = BigInt(tierMultBps);
  for (let i = 0; i < tier; i++) price = (price * mult) / BPS;
  return price;
}

/** Takeover price: `ceil(last_price * mult / 10_000)`. */
export function takeoverPrice(lastPrice: bigint, takeoverMultBps: number = TAKEOVER_MULT_BPS): bigint {
  return (lastPrice * BigInt(takeoverMultBps) + BPS - 1n) / BPS;
}

/** Lock epoch containing `now` (unix seconds). */
export function epochAt(now: number, launchTs: number, epochLen: number): number {
  return Math.floor(Math.max(0, now - launchTs) / epochLen);
}

/** Unix time epoch `k` unlocks: `launch_ts + (k+1)*epoch_len + lock_period`. */
export function unlockAt(k: number, launchTs: number, epochLen: number, lockPeriod: number): number {
  return launchTs + (k + 1) * epochLen + lockPeriod;
}

/** Price of a lot bought for `p0` and taken over `n` times (what the lock holds for it). */
export function priceAfterTakeovers(p0: bigint, n: number, takeoverMultBps: number = TAKEOVER_MULT_BPS): bigint {
  let p = p0;
  for (let i = 0; i < n; i++) p = takeoverPrice(p, takeoverMultBps);
  return p;
}

/** The ladder of one lot's price as multiples of its first price: 1, 1.5, 2.25, 3.375, ... */
export function takeoverLadder(steps: number): number[] {
  const out: number[] = [];
  let m = 1;
  for (let i = 0; i <= steps; i++) {
    out.push(m);
    m *= TAKEOVER_MULT_BPS / 10_000;
  }
  return out;
}
