/** Display helpers for token amounts, addresses and domains. */

/** Whole tokens from base units, as a plain decimal string (no grouping), trimmed. */
export function toTokens(amount: bigint, decimals: number, maxFraction = decimals): string {
  const neg = amount < 0n;
  const abs = neg ? -amount : amount;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  let frac = (abs % base).toString().padStart(decimals, "0").slice(0, maxFraction).replace(/0+$/, "");
  if (decimals === 0) frac = "";
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

/** `1,250,000` style, whole tokens (rounded down). */
export function formatTokens(amount: bigint, decimals: number): string {
  const whole = amount / 10n ** BigInt(decimals);
  return whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** `5,062.5` style: grouped whole tokens with up to `maxFraction` decimals (trailing zeros dropped). */
export function formatTokensExact(amount: bigint, decimals: number, maxFraction = 2): string {
  const [whole, frac] = toTokens(amount, decimals, maxFraction).split(".");
  const grouped = whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac ? `${grouped}.${frac}` : grouped;
}

/** `48.2M` style for counters. */
export function formatCompact(amount: bigint, decimals: number): string {
  const whole = Number(amount / 10n ** BigInt(decimals));
  const units: [number, string][] = [
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ];
  for (const [v, s] of units) {
    if (whole >= v) {
      const x = whole / v;
      return `${x >= 100 ? Math.floor(x) : Math.floor(x * 10) / 10}${s}`;
    }
  }
  return whole.toString();
}

/** Parses a user-typed token amount into base units. */
export function parseTokens(text: string, decimals: number): bigint {
  const t = text.trim().replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(t)) throw new Error("not a number");
  const [w, f = ""] = t.split(".");
  if (f.length > decimals) throw new Error("too many decimals");
  return BigInt(w!) * 10n ** BigInt(decimals) + BigInt(f.padEnd(decimals, "0") || "0");
}

export function shortAddress(address: string, chars = 4): string {
  return address.length <= chars * 2 + 1 ? address : `${address.slice(0, chars)}…${address.slice(-chars)}`;
}

export function formatInt(n: number): string {
  return n.toLocaleString("en-US");
}

/** Host of an https link, lowercased, without `www.`; null if it is not a valid https URL. */
export function linkDomain(link: string): string | null {
  try {
    const u = new URL(link);
    if (u.protocol !== "https:") return null;
    return u.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * A title safe to show: no bidi overrides/isolates (U+202A-202E, U+2066-2069), no zero-width or invisible format
 * characters, whitespace collapsed. The chain keeps the original; this is only for display.
 */
export function displayTitle(title: string): string {
  return title
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF\u00AD]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The share of the token supply in the lock as a percentage string, never rounded up: `4.21%`, `0.073%`,
 * `<0.0001%`. Precision grows as the share shrinks so small numbers still show their first digits.
 */
export function formatShare(locked: bigint, supply: bigint): string {
  if (supply <= 0n) return "—";
  if (locked <= 0n) return "0%";
  // percent with 6 decimal places, truncated
  const micro = (locked * 100_000_000n) / supply;
  const decimals = micro >= 10_000_000n ? 1 : micro >= 1_000_000n ? 2 : micro >= 10_000n ? 3 : micro >= 100n ? 4 : -1;
  if (decimals < 0) return "<0.0001%";
  const whole = micro / 1_000_000n;
  const frac = (micro % 1_000_000n).toString().padStart(6, "0").slice(0, decimals).replace(/0+$/, "");
  return `${whole}${frac ? `.${frac}` : ""}%`;
}

/** The same share as a plain fraction (0..1) for APIs; may be off in the last float digit. */
export function shareOfSupply(locked: bigint, supply: bigint): number | null {
  if (supply <= 0n) return null;
  return Number((locked * 1_000_000_000_000n) / supply) / 1e12;
}
