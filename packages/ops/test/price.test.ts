import { describe, expect, it } from "vitest";
import { tierPrice } from "@lotz/sdk";
import { basePriceUnits, fullBoardUnits } from "../src/price";

describe("base price from dollars", () => {
  it("is $5 worth of tokens, three significant digits, in base units", () => {
    // $5 at $0.0001234 per token = 40,518.6 tokens -> 40,500
    expect(basePriceUnits(5, 0.0001234, 6)).toBe(40_500_000_000n);
    // $5 at $0.00002 = 250,000 tokens exactly
    expect(basePriceUnits(5, 0.00002, 6)).toBe(250_000_000_000n);
    // $5 at $0.0999 = 50.05 tokens -> 50.1 (three digits, fractional tokens allowed)
    expect(basePriceUnits(5, 0.0999, 6)).toBe(50_100_000n);
    // $5 at $3 = 1.67 tokens
    expect(basePriceUnits(5, 3, 9)).toBe(1_670_000_000n);
    // 9.996 rounds up to 10.0, not 1000 in three digits
    expect(basePriceUnits(9.996, 1, 0)).toBe(10n);
  });

  it("stays within half a percent of the target", () => {
    for (const tokenUsd of [0.000001234, 0.00004567, 0.0089, 0.73, 12.5]) {
      const units = basePriceUnits(5, tokenUsd, 6);
      const usd = (Number(units) / 1e6) * tokenUsd;
      expect(Math.abs(usd - 5) / 5).toBeLessThan(0.005);
    }
  });

  it("refuses nonsense", () => {
    expect(() => basePriceUnits(5, 0, 6)).toThrow();
    expect(() => basePriceUnits(-1, 0.1, 6)).toThrow();
    expect(() => basePriceUnits(5, 1e9, 0)).toThrow(/zero/);
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
