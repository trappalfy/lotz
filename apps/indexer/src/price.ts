/**
 * The token's dollar price, for "≈ $" figures on the site (the program itself prices in tokens only).
 * While the token trades on its pump.fun bonding curve, the price is the curve's own (its reserves, on chain);
 * after it graduates, Jupiter's price. SOL/USD from Jupiter, CoinGecko if Jupiter does not answer.
 */
import { Connection, PublicKey } from "@solana/web3.js";

export const PUMP_PROGRAM_ID = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const CURVE_DISCRIMINATOR = [23, 183, 248, 55, 96, 216, 172, 96];
export const SOL_MINT = "So11111111111111111111111111111111111111112";

export interface TokenPrice {
  /** Dollars per whole token. */
  usd: number;
  source: "pump.fun curve" | "jupiter";
  at: string;
}

export function bondingCurveAddress(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("bonding-curve"), mint.toBuffer()], PUMP_PROGRAM_ID)[0];
}

export interface Curve {
  virtualTokenReserves: bigint;
  virtualSolReserves: bigint;
  complete: boolean;
}

/** A pump.fun bonding curve account (checked by its discriminator), or null. */
export function decodeCurve(data: Uint8Array): Curve | null {
  if (data.length < 49 || CURVE_DISCRIMINATOR.some((b, i) => data[i] !== b)) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    virtualTokenReserves: view.getBigUint64(8, true),
    virtualSolReserves: view.getBigUint64(16, true),
    complete: data[48] === 1,
  };
}

/** SOL per whole token at the curve's current reserves (the price of the next small trade, before fees). */
export function curvePriceSol(c: Curve, decimals: number): number {
  if (c.virtualTokenReserves === 0n) return 0;
  return Number(c.virtualSolReserves) / 1e9 / (Number(c.virtualTokenReserves) / 10 ** decimals);
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

async function getJson(f: Fetch, url: string): Promise<unknown> {
  const r = await f(url, { signal: AbortSignal.timeout(8_000), headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`${new URL(url).host}: HTTP ${r.status}`);
  return r.json();
}

/** Dollar prices from Jupiter (Price API v3), by mint; mints it does not know are left out. */
export async function jupiterUsd(mints: string[], f: Fetch = fetch): Promise<Map<string, number>> {
  const j = (await getJson(f, `https://lite-api.jup.ag/price/v3?ids=${mints.join(",")}`)) as Record<string, { usdPrice?: number } | null>;
  const out = new Map<string, number>();
  for (const m of mints) {
    const p = j[m]?.usdPrice;
    if (typeof p === "number" && Number.isFinite(p) && p > 0) out.set(m, p);
  }
  return out;
}

export async function coingeckoSolUsd(f: Fetch = fetch): Promise<number | null> {
  const j = (await getJson(f, "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd")) as { solana?: { usd?: number } };
  const p = j.solana?.usd;
  return typeof p === "number" && p > 0 ? p : null;
}

/** The token's dollar price now, or null when no source has one. */
export async function readTokenPrice(o: { connection: Connection; mint: PublicKey; decimals: number; fetch?: Fetch; now?: Date }): Promise<TokenPrice | null> {
  const f = o.fetch ?? fetch;
  const mint = o.mint.toBase58();
  const [curveInfo, jup] = await Promise.all([
    o.connection.getAccountInfo(bondingCurveAddress(o.mint), "confirmed"),
    jupiterUsd([SOL_MINT, mint], f).catch(() => new Map<string, number>()),
  ]);
  const at = (o.now ?? new Date()).toISOString();
  const curve = curveInfo?.owner.equals(PUMP_PROGRAM_ID) ? decodeCurve(curveInfo.data) : null;
  if (curve && !curve.complete) {
    const solUsd = jup.get(SOL_MINT) ?? (await coingeckoSolUsd(f).catch(() => null));
    if (!solUsd) return null;
    return { usd: curvePriceSol(curve, o.decimals) * solUsd, source: "pump.fun curve", at };
  }
  const usd = jup.get(mint);
  return usd ? { usd, source: "jupiter", at } : null;
}
