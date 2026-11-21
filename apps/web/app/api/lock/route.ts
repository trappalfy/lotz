import * as db from "@lotz/db";
import { TOTAL_LOTS, formatShare, formatTokens, shareOfSupply } from "@lotz/sdk";
import { pool } from "@/lib/server/db";
import { storage } from "@/lib/server/storage";

export const dynamic = "force-dynamic";

/**
 * Public, read-only: how much of the token supply is in the lock, for posts and bots.
 * `share` is a fraction (0..1); `sharePercent` is the same, truncated, as text. `card` is a 1200x675 image of it.
 */
export async function GET() {
  const p = pool();
  const [c, supply, card] = await Promise.all([
    db.getConfig(p),
    db.kvGet<db.TokenSupply>(p, db.TOKEN_SUPPLY_KEY),
    db.kvGet<db.ShareCard>(p, db.SHARE_CARD_KEY),
  ]);
  const decimals = c?.tokenDecimals ?? 6;
  const lockedNow = c ? c.totalLocked - c.totalReleased : 0n;
  const total = supply ? BigInt(supply.amount) : null;
  const body = {
    tokenMint: c?.tokenMint ?? null,
    decimals,
    lockedNow: lockedNow.toString(),
    lockedNowTokens: formatTokens(lockedNow, decimals),
    supply: total?.toString() ?? null,
    share: total ? shareOfSupply(lockedNow, total) : null,
    sharePercent: total ? formatShare(lockedNow, total) : null,
    totalLocked: (c?.totalLocked ?? 0n).toString(),
    totalReleased: (c?.totalReleased ?? 0n).toString(),
    lotsSold: c?.lotsSold ?? 0,
    totalLots: TOTAL_LOTS,
    takeovers: c?.takeovers ?? 0,
    card: card ? `${storage().publicUrl(card.key)}?v=${card.version}` : null,
    supplyReadAt: supply?.at ?? null,
  };
  return Response.json(body, {
    headers: {
      "cache-control": "public, max-age=0, s-maxage=10, stale-while-revalidate=60",
      "access-control-allow-origin": "*",
    },
  });
}
