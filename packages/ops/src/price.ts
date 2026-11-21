/** Turning the owner's dollar price into the on-chain BASE_PRICE (token base units, fixed forever). */

/**
 * Base units of the token per free lot for a target dollar price, at the token's dollar price right now. Rounded
 * to three significant digits so the price reads cleanly on the site (within 0.5% of the target).
 */
export function basePriceUnits(lotUsd: number, tokenUsd: number, decimals: number): bigint {
  if (!(lotUsd > 0) || !(tokenUsd > 0) || !Number.isFinite(lotUsd / tokenUsd)) {
    throw new Error("BASE_PRICE_USD and TOKEN_PRICE_USD must be positive numbers");
  }
  const tokens = lotUsd / tokenUsd;
  const exp = Math.floor(Math.log10(tokens)) - 2; // keep three digits
  let digits = Math.round(tokens / 10 ** exp);
  let e = exp;
  if (digits >= 1000) {
    digits = Math.round(digits / 10);
    e += 1;
  }
  const shift = e + decimals;
  const units = shift >= 0 ? BigInt(digits) * 10n ** BigInt(shift) : BigInt(Math.round(digits / 10 ** -shift));
  if (units <= 0n) throw new Error("price rounds to zero base units");
  return units;
}

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
