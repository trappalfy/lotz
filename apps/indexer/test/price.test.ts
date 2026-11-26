import { describe, expect, it } from "vitest";
import { Keypair, PublicKey, type Connection } from "@solana/web3.js";
import { PUMP_PROGRAM_ID, SOL_MINT, bondingCurveAddress, curvePriceSol, decodeCurve, readTokenPrice } from "../src/price";

const DISC = [23, 183, 248, 55, 96, 216, 172, 96];
function curveData(vTok: bigint, vSol: bigint, complete = false): Buffer {
  const d = Buffer.alloc(166);
  Buffer.from(DISC).copy(d, 0);
  d.writeBigUInt64LE(vTok, 8);
  d.writeBigUInt64LE(vSol, 16);
  d.writeBigUInt64LE(1_000_000_000_000_000n, 40);
  d[48] = complete ? 1 : 0;
  return d;
}
const mint = Keypair.generate().publicKey;
const conn = (data: Buffer | null) =>
  ({ getAccountInfo: async (k: PublicKey) => (data && k.equals(bondingCurveAddress(mint)) ? { owner: PUMP_PROGRAM_ID, data } : null) }) as unknown as Connection;
const fetchFrom =
  (answers: Record<string, unknown>) =>
  async (url: string): Promise<Response> => {
    const host = new URL(url).host;
    if (!(host in answers)) return new Response("down", { status: 503 });
    return Response.json(answers[host]);
  };

describe("token price", () => {
  it("reads the curve: at pump.fun's start (30 SOL, 1073M tokens) a token is ~28 SOL per billion", () => {
    const c = decodeCurve(curveData(1_073_000_000_000_000n, 30_000_000_000n))!;
    expect(c.complete).toBe(false);
    expect(curvePriceSol(c, 6) * 1e9).toBeCloseTo(27.96, 2);
    expect(decodeCurve(Buffer.alloc(166))).toBeNull(); // not a curve: wrong discriminator
  });

  it("on the curve: the curve's price in SOL times SOL/USD from Jupiter", async () => {
    const p = await readTokenPrice({
      connection: conn(curveData(1_073_000_000_000_000n, 30_000_000_000n)),
      mint,
      decimals: 6,
      fetch: fetchFrom({ "lite-api.jup.ag": { [SOL_MINT]: { usdPrice: 100 }, [mint.toBase58()]: { usdPrice: 1 } } }),
    });
    expect(p?.source).toBe("pump.fun curve");
    expect(p!.usd * 1e9).toBeCloseTo(2796, 0); // market cap of 1B tokens: ~$2.8k
  });

  it("SOL/USD from CoinGecko when Jupiter does not answer", async () => {
    const p = await readTokenPrice({
      connection: conn(curveData(1_073_000_000_000_000n, 30_000_000_000n)),
      mint,
      decimals: 6,
      fetch: fetchFrom({ "api.coingecko.com": { solana: { usd: 50 } } }),
    });
    expect(p!.usd * 1e9).toBeCloseTo(1398, 0);
  });

  it("after graduation (curve complete, or no curve): Jupiter's price of the token", async () => {
    const answers = { "lite-api.jup.ag": { [SOL_MINT]: { usdPrice: 100 }, [mint.toBase58()]: { usdPrice: 0.0003 } } };
    for (const data of [curveData(0n, 0n, true), null]) {
      const p = await readTokenPrice({ connection: conn(data), mint, decimals: 6, fetch: fetchFrom(answers) });
      expect(p).toMatchObject({ usd: 0.0003, source: "jupiter" });
    }
  });

  it("null when no source knows", async () => {
    expect(await readTokenPrice({ connection: conn(null), mint, decimals: 6, fetch: fetchFrom({}) })).toBeNull();
  });
});
