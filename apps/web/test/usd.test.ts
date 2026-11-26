import { describe, expect, it } from "vitest";
import { formatUsd, marketCap, usdOf } from "../lib/client/usd";

const now = Date.parse("2026-11-26T12:00:00Z");
// $14k market cap: 1B tokens at $0.000014
const stats = { tokenUsd: 0.000014, priceAt: "2026-11-26T11:59:45Z", supply: "1000000000000000" };

describe("dollar figures", () => {
  it("a 100x100 px block (100 lots of 7000 tokens) at a $14k market cap is about $9.80", () => {
    expect(usdOf(700_000n * 10n ** 6n, 6, stats, now)).toBe("≈ $9.80");
    expect(marketCap(6, stats, now)).toBe("≈ $14k");
  });

  it("nothing without a price, or with one older than 10 minutes", () => {
    expect(usdOf(1n, 6, { tokenUsd: null, priceAt: null }, now)).toBeNull();
    expect(usdOf(10n ** 12n, 6, { ...stats, priceAt: "2026-11-26T11:49:00Z" }, now)).toBeNull();
    expect(marketCap(6, { ...stats, supply: null }, now)).toBeNull();
  });

  it("formats small, large and very large amounts", () => {
    expect(formatUsd(0.004)).toBe("<$0.01");
    expect(formatUsd(1234.5)).toBe("$1.2k");
    expect(formatUsd(2_500_000)).toBe("$2.5M");
  });
});
