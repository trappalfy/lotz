import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import {
  createPool,
  getActivity,
  getAllLots,
  getLotHistory,
  getMostTakenLot,
  insertAd,
  insertEvent,
  migrate,
  recordLotHistory,
  setLots,
  getAdsOnDomain,
  rateHit,
  type Pool,
} from "../src";

const URL = process.env.TEST_DATABASE_URL ?? "postgres://127.0.0.1:5433/lotz_test";
let pool: Pool;

beforeAll(async () => {
  // fresh schema each run
  const admin = new pg.Client({ connectionString: URL });
  await admin.connect();
  await admin.query("drop schema public cascade; create schema public;");
  await admin.end();
  pool = createPool(URL);
  await migrate(pool);
});

afterAll(async () => {
  await pool.end();
});

describe("db", () => {
  it("migrates once", async () => {
    expect(await migrate(pool)).toEqual([]);
    expect(await getAllLots(pool)).toHaveLength(10_000);
  });

  it("stores ads, lots, events and history", async () => {
    const base = {
      owner: "Owner1",
      nonce: 2n ** 63n,
      imageHash: "ab",
      imageUri: "https://cdn/x",
      link: "https://shop.example.com",
      linkDomain: "shop.example.com",
      title: "your coin",
      paidTotal: 10n ** 19n,
      createdAt: new Date(),
      createdSlot: 1,
      signature: "sig",
    };
    expect(await insertAd(pool, { ...base, adId: 1, address: "Ad1", x: 0, y: 0, w: 2, h: 1, lotsAlive: 2 })).toBe(true);
    expect(await insertAd(pool, { ...base, adId: 1, address: "Ad1", x: 0, y: 0, w: 2, h: 1, lotsAlive: 2 })).toBe(false);
    await setLots(pool, [
      { lot: 0, adId: 1, lastPrice: 5n },
      { lot: 1, adId: 1, lastPrice: 18_446_744_073_709_551_615n },
    ]);
    await recordLotHistory(pool, [0, 1], 5n, new Date(), []);
    await recordLotHistory(pool, [], 0n, new Date(), [1]);
    const lots = await getAllLots(pool);
    expect(lots[1]!.lastPrice).toBe(18_446_744_073_709_551_615n);
    expect(lots[1]!.takeovers).toBe(1);
    expect((await getMostTakenLot(pool))!.lot).toBe(1);

    const id = await insertEvent(pool, {
      signature: "s1",
      eventIndex: 0,
      slot: 1,
      blockTime: new Date(),
      name: "LotsBought",
      adId: 1,
      actor: "Owner1",
      rect: { x: 0, y: 0, w: 2, h: 1 },
      data: { a: 1 },
    });
    expect(id).toBeTypeOf("number");
    expect(
      await insertEvent(pool, {
        signature: "s1",
        eventIndex: 0,
        slot: 1,
        blockTime: new Date(),
        name: "LotsBought",
        adId: 1,
        actor: null,
        data: {},
      }),
    ).toBeNull();
    expect(await getActivity(pool, 10)).toHaveLength(1);
    expect(await getLotHistory(pool, 1, 0)).toHaveLength(1);
    expect(await getLotHistory(pool, 2, 0)).toHaveLength(0);
    expect(await getAdsOnDomain(pool, "example.com")).toHaveLength(1);
    expect(await getAdsOnDomain(pool, "ample.com")).toHaveLength(0);
  });

  it("counts requests per key in a shared window", async () => {
    expect(await rateHit(pool, "upload:1.2.3.4", 3_600)).toBe(1);
    expect(await rateHit(pool, "upload:1.2.3.4", 3_600)).toBe(2);
    expect(await rateHit(pool, "upload:5.6.7.8", 3_600)).toBe(1);
    const [a, b] = await Promise.all([rateHit(pool, "upload:9", 3_600), rateHit(pool, "upload:9", 3_600)]);
    expect([a, b].sort()).toEqual([1, 2]);
  });
});
