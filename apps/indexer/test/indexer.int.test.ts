/**
 * End to end against a real solana-test-validator (own ports) and the lotz_test database:
 * purchase -> events -> database -> board render -> stream notification.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import sharp from "sharp";
import { Connection, Keypair } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { IDL_PROGRAM_ID, lotIndex } from "@lotz/sdk";
import * as db from "@lotz/db";
import { processUpload } from "@lotz/imaging";
import { LocalStorage } from "@lotz/storage";
import { LocalLotz, TOKEN, loadKeypair, startValidator, type RunningValidator } from "@lotz/local";
import { Chain } from "../src/chain";
import { Indexer, type StreamMessage } from "../src/indexer";
import { BOARD_4X } from "../src/renderer";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const DB_URL = process.env.TEST_DATABASE_URL ?? "postgres://127.0.0.1:5433/lotz_test";
const BASE = 1_000n * TOKEN;

let validator: RunningValidator;
let lotz: LocalLotz;
let pool: db.Pool;
let storage: LocalStorage;
let indexer: Indexer;
let listener: pg.PoolClient;
const messages: StreamMessage[] = [];

async function uploadSolid(color: string, w: number, h: number): Promise<{ uri: string; hash: Uint8Array }> {
  const src = await sharp({ create: { width: w * 50, height: h * 50, channels: 3, background: color } }).png().toBuffer();
  const out = await processUpload(new Uint8Array(src), w, h);
  const uri = await storage.put(`i/${out.hash}.webp`, out.bytes, "image/webp");
  return { uri, hash: Uint8Array.from(Buffer.from(out.hash, "hex")) };
}

/** RGBA at the center of a lot in the 4x board buffer. */
function pixel(lx: number, ly: number): number[] {
  const i = ((ly * 40 + 21) * BOARD_4X + lx * 40 + 20) * 4;
  return [...indexer.renderer.buf.subarray(i, i + 4)];
}

beforeAll(async () => {
  const admin = loadKeypair(join(ROOT, "keys/dev-wallet.json"));
  validator = await startValidator({
    ledger: mkdtempSync(join(tmpdir(), "lotz-ledger-")),
    programSo: join(ROOT, "target/deploy/lotz.so"),
    programId: IDL_PROGRAM_ID,
    upgradeAuthority: admin.publicKey,
    rpcPort: 28899,
    faucetPort: 29900,
    gossipPort: 28001,
    dynamicPortRange: "28100-28200",
    reset: true,
  });
  const connection = new Connection(validator.url, { commitment: "confirmed", wsEndpoint: validator.wsUrl });
  const sig = await connection.requestAirdrop(admin.publicKey, 100e9);
  await connection.confirmTransaction({ signature: sig, ...(await connection.getLatestBlockhash()) }, "confirmed");
  const mint = await LocalLotz.createMint(connection, admin);
  lotz = new LocalLotz(connection, admin, {
    programId: IDL_PROGRAM_ID,
    mint,
    tokenProgram: TOKEN_PROGRAM_ID,
    treasury: Keypair.generate().publicKey,
  });
  await lotz.initialize(admin, { basePrice: BASE, tierSize: 1000, tierMultBps: 12_500, maxRect: 10, paused: false });
  await lotz.createShards(admin);

  const reset = new pg.Client({ connectionString: DB_URL });
  await reset.connect();
  await reset.query("drop schema public cascade; create schema public;");
  await reset.end();
  pool = db.createPool(DB_URL);
  await db.migrate(pool);
  storage = new LocalStorage(mkdtempSync(join(tmpdir(), "lotz-storage-")), "http://127.0.0.1:3999/media");

  listener = await pool.connect();
  await listener.query(`listen ${db.STREAM_CHANNEL}`);
  listener.on("notification", (n) => messages.push(JSON.parse(n.payload!) as StreamMessage));

  indexer = new Indexer({ chain: new Chain(connection, IDL_PROGRAM_ID), pool, storage, log: () => {} });
  await indexer.init();
}, 180_000);

afterAll(async () => {
  listener?.release();
  await pool?.end();
  await validator?.stop();
});

describe("indexer", () => {
  let alice: Keypair;
  let bob: Keypair;
  let aliceAd = 0;

  it("starts with an empty, rendered board", async () => {
    const images = await db.kvGet<db.BoardImages>(pool, db.BOARD_IMAGES_KEY);
    expect(images?.tiles).toHaveLength(16);
    expect(await storage.get(images!.x1)).not.toBeNull();
    const c = await db.getConfig(pool);
    expect(c?.lotsSold).toBe(0);
    expect(c?.tokenDecimals).toBe(6);
    expect(c?.upgradeAuthority).toBe(lotz.payer.publicKey.toBase58());
    expect(pixel(0, 0)[3]).toBe(0); // free lots are transparent
  });

  it("indexes a purchase, verifies the image and paints it", async () => {
    alice = await lotz.fundedWallet(1_000_000n * TOKEN);
    bob = await lotz.fundedWallet(1_000_000n * TOKEN);
    const img = await uploadSolid("#ff0000", 2, 2);
    const res = await lotz.buy(alice, { x: 0, y: 0, w: 2, h: 2 }, { imageUri: img.uri, imageHash: img.hash, title: "red" });
    messages.length = 0;
    await indexer.handleSignature(res.sig);

    const ads = await db.getAdsByOwner(pool, alice.publicKey.toBase58());
    expect(ads).toHaveLength(1);
    const ad = ads[0]!;
    aliceAd = ad.adId;
    expect(ad.imageStatus).toBe("ok");
    expect(ad.hidden).toBe(false);
    expect(ad.lotsAlive).toBe(4);
    expect(ad.title).toBe("red");
    expect(ad.linkDomain).toBe("example.com");
    expect(ad.nonce).toBe(res.args.nonce);

    const lots = await db.getAllLots(pool);
    for (const [lx, ly] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
      expect(lots[lotIndex(lx, ly)]!.adId).toBe(ad.adId);
      expect(lots[lotIndex(lx, ly)]!.lastPrice).toBe(BASE);
      expect(lots[lotIndex(lx, ly)]!.firstPrice).toBe(BASE);
    }
    expect(lots[lotIndex(2, 0)]!.adId).toBe(0);

    const [r, g, b, a] = pixel(1, 1);
    expect(r).toBeGreaterThan(240);
    expect(g).toBeLessThan(20);
    expect(b).toBeLessThan(20);
    expect(a).toBe(255);

    expect((await db.getActivity(pool, 10))[0]!.adId).toBe(ad.adId);
    expect((await db.getConfig(pool))!.lotsSold).toBe(4);
    expect((await db.getEpochs(pool))[0]!.amount).toBe(4n * BASE);

    await new Promise((r) => setTimeout(r, 200));
    const buy = messages.find((m) => m.type === "buy");
    expect(buy?.type === "buy" && buy.buy.adId).toBe(ad.adId);
    expect(buy?.stats.lotsSold).toBe(4);
  });

  it("indexes a takeover: lot history, refunds, hole in the old ad", async () => {
    const img = await uploadSolid("#0000ff", 2, 2);
    const res = await lotz.buy(bob, { x: 1, y: 1, w: 2, h: 2 }, { imageUri: img.uri, imageHash: img.hash });
    await indexer.handleSignature(res.sig);

    const old = (await db.getAd(pool, aliceAd))!;
    expect(old.lotsAlive).toBe(3);
    expect(old.refundDue).toBe(BASE);
    const lot = (await db.getLot(pool, lotIndex(1, 1)))!;
    expect(lot.takeovers).toBe(1);
    expect(lot.lastPrice).toBe((BASE * 3n) / 2n);
    expect((await db.getMostTakenLot(pool))!.lot).toBe(lotIndex(1, 1));
    expect(await db.getLotHistory(pool, 1, 1)).toHaveLength(2);
    // (1,1) is blue now, (0,0) still red
    expect(pixel(1, 1)[2]).toBeGreaterThan(240);
    expect(pixel(0, 0)[0]).toBeGreaterThan(240);
  });

  it("the same transaction twice changes nothing", async () => {
    const before = await db.getAllLots(pool);
    const sigs = await lotz.connection.getSignaturesForAddress(IDL_PROGRAM_ID, { limit: 1 });
    await indexer.handleSignature(sigs[0]!.signature);
    expect(await db.getAllLots(pool)).toEqual(before);
  });

  it("hides an ad whose image does not match its hash", async () => {
    const img = await uploadSolid("#00ff00", 1, 1);
    const res = await lotz.buy(alice, { x: 10, y: 10, w: 1, h: 1 }, { imageUri: img.uri, imageHash: new Uint8Array(32).fill(9) });
    await indexer.handleSignature(res.sig);
    const ad = (await db.getAdsByOwner(pool, alice.publicKey.toBase58())).find((a) => a.x === 10)!;
    expect(ad.imageStatus).toBe("mismatch");
    expect(ad.hidden).toBe(true);
    expect(ad.hiddenReason).toBe("hash_mismatch");
    const p = pixel(10, 10);
    expect([0xde, 0xff]).toContain(p[0]);
    expect(p[1]).toBe(p[0]);
  });

  it("hides ads on a blocked domain", async () => {
    await db.addBlockedDomain(pool, "blocked.example", null, "test");
    await indexer.onModeration([]);
    const img = await uploadSolid("#00ff00", 1, 1);
    const res = await lotz.buy(alice, { x: 20, y: 20, w: 1, h: 1 }, {
      imageUri: img.uri,
      imageHash: img.hash,
      link: "https://shop.blocked.example/x",
    });
    await indexer.handleSignature(res.sig);
    const ad = (await db.getAdsByOwner(pool, alice.publicKey.toBase58())).find((a) => a.x === 20)!;
    expect(ad.hidden).toBe(true);
    expect(ad.hiddenReason).toBe("blocked_domain");
  });

  it("indexes a refund claim", async () => {
    const address = (await db.getAd(pool, aliceAd))!.address;
    const res = await lotz.send([lotz.ixs.claimRefund(alice.publicKey, new (await import("@solana/web3.js")).PublicKey(address))], [alice]);
    await indexer.handleSignature(res.sig);
    expect((await db.getAd(pool, aliceAd))!.refundDue).toBe(0n);
  });

  it("reconciles a corrupted database from the chain", async () => {
    await pool.query("update lots set ad_id = 0, last_price = 0");
    await pool.query("update ads set lots_alive = 99");
    await indexer.fullReconcile();
    const lots = await db.getAllLots(pool);
    expect(lots[lotIndex(0, 0)]!.adId).toBe(aliceAd);
    expect(lots[lotIndex(2, 2)]!.lastPrice).toBe(BASE);
    expect((await db.getAd(pool, aliceAd))!.lotsAlive).toBe(3);
  });

  it("polling finds a transaction nobody told us about, once", async () => {
    const img = await uploadSolid("#ffaa00", 1, 1);
    await lotz.buy(bob, { x: 30, y: 30, w: 1, h: 1 }, { imageUri: img.uri, imageHash: img.hash });
    const { pollOnce } = await import("../src/poll");
    expect(await pollOnce(lotz.connection, IDL_PROGRAM_ID, pool, indexer)).toBeGreaterThan(0);
    expect((await db.getAllLots(pool))[lotIndex(30, 30)]!.adId).toBeGreaterThan(0);
    const events = (await db.getActivity(pool, 100)).length;
    expect(await pollOnce(lotz.connection, IDL_PROGRAM_ID, pool, indexer)).toBe(0);
    expect((await db.getActivity(pool, 100)).length).toBe(events);
  });

  it("renders the OG card", async () => {
    await indexer.renderOg();
    const png = await storage.get("og/latest.png");
    const meta = await sharp(png!).metadata();
    expect([meta.width, meta.height]).toEqual([1200, 630]);
  });
});
