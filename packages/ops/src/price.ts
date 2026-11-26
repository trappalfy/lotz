/** Board totals for the launch plan. BASE_PRICE itself is set in whole tokens (launch.ts, BASE_PRICE_TOKENS). */

/** Tokens needed to sell every free lot once: Σ over tiers of tier_size × tier price (floored per step, like the program). */
export function fullBoardUnits(basePrice: bigint, tierSize: number, tierMultBps: number, totalLots = 10_000): bigint {
  let sum = 0n;
  let price = basePrice;
  for (let sold = 0; sold < totalLots; sold += tierSize) {
    sum += price * BigInt(Math.min(tierSize, totalLots - sold));
    price = (price * BigInt(tierMultBps)) / 10_000n;
  }
  return sum;
}
