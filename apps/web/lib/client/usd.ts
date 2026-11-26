/** Approximate dollar figures from the token's price (the program itself prices in tokens only). */

/** A price older than this is not shown: better no figure than a stale one. */
export const PRICE_MAX_AGE_MS = 10 * 60_000;

export interface PriceStats {
  tokenUsd: number | null;
  priceAt: string | null;
  supply?: string | null;
}

/** Dollars per whole token if the price is fresh, else null. */
export function freshUsd(s: PriceStats | null | undefined, now = Date.now()): number | null {
  if (!s?.tokenUsd || !s.priceAt) return null;
  const age = now - Date.parse(s.priceAt);
  return age >= -60_000 && age <= PRICE_MAX_AGE_MS ? s.tokenUsd : null;
}

export function formatUsd(v: number): string {
  if (v < 0.01) return "<$0.01";
  if (v < 1_000) return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (v < 1_000_000) return `$${(v / 1_000).toLocaleString("en-US", { maximumFractionDigits: 1 })}k`;
  return `$${(v / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 2 })}M`;
}

/** "≈ $14.00" for an amount in base units, or null without a fresh price. */
export function usdOf(units: bigint, decimals: number, s: PriceStats | null | undefined, now = Date.now()): string | null {
  const usd = freshUsd(s, now);
  if (usd === null) return null;
  return `≈ ${formatUsd((Number(units) / 10 ** decimals) * usd)}`;
}

/** Market cap (the whole supply at the current price), or null. */
export function marketCap(decimals: number, s: PriceStats | null | undefined, now = Date.now()): string | null {
  if (!s?.supply) return null;
  return usdOf(BigInt(s.supply), decimals, s, now);
}
