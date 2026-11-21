/**
 * Runs under `anchor test` (which starts solana-test-validator and deploys the program as upgradeable with the
 * dev wallet as upgrade authority). The time-dependent scenarios (unlock after 365 days) are in the LiteSVM suite.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { Connection, Keypair } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { IDL_PROGRAM_ID, fetchConfig, MAX_TX_BYTES, type LotsBoughtEvent } from "@lotz/sdk";
import { LocalLotz, TOKEN, assertLocal, loadKeypair } from "@lotz/local";

const RPC = process.env.ANCHOR_PROVIDER_URL ?? "http://127.0.0.1:8899";
const WALLET = process.env.ANCHOR_WALLET ?? new URL("../../../keys/dev-wallet.json", import.meta.url).pathname;
const BASE = 1_000n * TOKEN;

let lotz: LocalLotz;
let admin: Keypair;

beforeAll(async () => {
  assertLocal(RPC);
  const connection = new Connection(RPC, "confirmed");
  admin = loadKeypair(WALLET);
  const mint = await LocalLotz.createMint(connection, admin);
  const treasury = Keypair.generate().publicKey;
  lotz = new LocalLotz(connection, admin, { programId: IDL_PROGRAM_ID, mint, tokenProgram: TOKEN_PROGRAM_ID, treasury });
  await lotz.initialize(admin, { basePrice: BASE, tierSize: 1000, tierMultBps: 12_500, maxRect: 10, paused: false });
  await lotz.createShards(admin);
  await lotz.createLookupTable(admin);
});

describe("lotz on a local validator", () => {
  it("is initialized", async () => {
    const c = await fetchConfig(lotz.connection, lotz.ixs.pdas);
    expect(c?.admin.equals(admin.publicKey)).toBe(true);
    expect(c?.basePrice).toBe(BASE);
    expect(c?.lotsSold).toBe(0);
  });

  it("buys free lots, takes over, mixes, claims and closes", async () => {
    const alice = await lotz.fundedWallet(1_000_000n * TOKEN);
    const bob = await lotz.fundedWallet(1_000_000n * TOKEN);

    // free lots
    const a = await lotz.buy(alice, { x: 0, y: 0, w: 3, h: 3 });
    const ev = a.events.find((e) => e.name === "LotsBought") as LotsBoughtEvent;
    expect(ev.paidTotal).toBe(9n * BASE);
    expect(a.quote.total).toBe(9n * BASE);
    expect(await lotz.vaultBalance("lock")).toBe(9n * BASE);

    // mixed: 4 of Alice's lots (1.5x) and 5 free
    const b = await lotz.buy(bob, { x: 1, y: 1, w: 3, h: 3 });
    const evb = b.events.find((e) => e.name === "LotsBought") as LotsBoughtEvent;
    expect(evb.takenLots).toBe(4);
    expect(evb.freeLots).toBe(5);
    expect(evb.paidTotal).toBe(5n * BASE + 4n * ((BASE * 3n) / 2n));
    expect(evb.refunded).toBe(4n * BASE);
    expect(evb.prior).toEqual([{ adId: ev.adId, lots: 4, refund: 4n * BASE }]);
    expect(await lotz.vaultBalance("refund")).toBe(4n * BASE);

    // max_total below the price: refused
    await expect(lotz.buy(alice, { x: 1, y: 1, w: 1, h: 1 }, { maxTotal: 1n })).rejects.toThrow(/SlippageExceeded|0x177d/);

    // Alice claims her refund
    const before = await lotz.tokenBalance(alice.publicKey);
    const aliceAd = lotz.ixs.pdas.ad(alice.publicKey, a.args.nonce);
    await lotz.send([lotz.ixs.claimRefund(alice.publicKey, aliceAd)], [alice]);
    expect((await lotz.tokenBalance(alice.publicKey)) - before).toBe(4n * BASE);

    // Bob takes the rest of Alice's ad; she claims and closes it
    await lotz.buy(bob, { x: 0, y: 0, w: 3, h: 1 });
    await lotz.buy(bob, { x: 0, y: 1, w: 1, h: 2 });
    await lotz.send([lotz.ixs.claimRefund(alice.publicKey, aliceAd)], [alice]);
    const closed = await lotz.send([lotz.ixs.closeAd(alice.publicKey, aliceAd)], [alice]);
    expect(closed.events.map((e) => e.name)).toEqual(["AdClosed"]);
    expect(await lotz.tokenBalance(alice.publicKey)).toBe(1_000_000n * TOKEN);
  });

  it("the lock cannot be released early", async () => {
    const cranker = await lotz.fundedWallet(0n);
    await expect(lotz.send([lotz.ixs.releaseEpoch(cranker.publicKey, 0)], [cranker])).rejects.toThrow(/StillLocked|0x1785/);
  });

  it("the worst-case purchase fits in one transaction with the lookup table", async () => {
    const owners = await Promise.all(Array.from({ length: 16 }, () => lotz.fundedWallet(1_000_000n * TOKEN)));
    for (const [i, o] of owners.entries()) {
      await lotz.buy(o, { x: 45 + (i % 4) * 3, y: 45 + Math.floor(i / 4) * 3, w: 1, h: 1 });
    }
    const taker = await lotz.fundedWallet(100_000_000n * TOKEN);
    const res = await lotz.buy(taker, { x: 45, y: 45, w: 10, h: 10 }, { link: "https://example.com/" + "a".repeat(60) });
    expect(res.quote.priorAdIds).toHaveLength(16);
    expect(res.size).toBeLessThanOrEqual(MAX_TX_BYTES);
    const ev = res.events.find((e) => e.name === "LotsBought") as LotsBoughtEvent;
    expect(ev.takenLots).toBe(16);
    expect(ev.freeLots).toBe(84);
  });
});
