import { describe, expect, it } from "vitest";
import { tierPrice } from "@lotz/sdk";
import { fullBoardUnits } from "../src/price";

describe("launch price", () => {
  // the owner's decision: 7000 whole tokens per free lot at tier 0, tiers x1.25 every 1000 lots
  const base = 7000n * 10n ** 6n; // pump.fun tokens have 6 decimals

  it("climbs from 7000 to about 52,154 tokens over the ten tiers", () => {
    expect(tierPrice(base, 12_500, 0)).toBe(7_000_000_000n);
    expect(tierPrice(base, 12_500, 1)).toBe(8_750_000_000n);
    expect(Number(tierPrice(base, 12_500, 9)) / 1e6).toBeCloseTo(52_154.06, 1);
  });

  it("selling every free lot once takes about 23% of a 1 billion supply", () => {
    const tokens = Number(fullBoardUnits(base, 1000, 12_500)) / 1e6;
    expect(tokens).toBeGreaterThan(232_700_000);
    expect(tokens).toBeLessThan(232_800_000);
  });

  it("full board total matches the tier prices the program uses", () => {
    const base = 250_000_000_000n;
    let expected = 0n;
    for (let t = 0; t < 10; t++) expected += 1000n * tierPrice(base, 12_500, t);
    expect(fullBoardUnits(base, 1000, 12_500)).toBe(expected);
    // about 33,253 lots' worth of the base price
    expect(Number(fullBoardUnits(base, 1000, 12_500) / base)).toBe(33_252);
  });
});
