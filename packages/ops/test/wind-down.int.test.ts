/**
 * Winding Lotz down on a real solana-test-validator (own ports): launch, purchases with a takeover, then the whole
 * wind-down, including closing the lookup table and the program itself. Checks where every lamport went.
 * The lock cannot age a year on a real validator, so this runs the "strand" path; LiteSVM tests cover the rest.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { IDL_PROGRAM_ID, LotzPdas, ata, fetchConfig } from "@lotz/sdk";
import { LocalLotz, TOKEN, loadKeypair, startValidator, type RunningValidator } from "@lotz/local";
import { executeWindDown, planWindDown, type WindDownOptions } from "../src/wind-down-lib";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const BASE = 1_000n * TOKEN;

let validator: RunningValidator;
let connection: Connection;
let lotz: LocalLotz;
let admin: Keypair;
let table: PublicKey;
let alice: Keypair;
let bob: Keypair;
let carol: Keypair;
const pdas = new LotzPdas(IDL_PROGRAM_ID);

beforeAll(async () => {
  admin = loadKeypair(join(ROOT, "keys/dev-wallet.json"));
  validator = await startValidator({
    ledger: mkdtempSync(join(tmpdir(), "lotz-winddown-")),
    programSo: join(ROOT, "target/deploy/lotz.so"),
    programId: IDL_PROGRAM_ID,
    upgradeAuthority: admin.publicKey,
    rpcPort: 29899,
    faucetPort: 29990,
    gossipPort: 29001,
    dynamicPortRange: "29100-29200",
    reset: true,
  });
  connection = new Connection(validator.url, "confirmed");
  const sig = await connection.requestAirdrop(admin.publicKey, 100e9);
  await connection.confirmTransaction({ signature: sig, ...(await connection.getLatestBlockhash()) }, "confirmed");
  const mint = await LocalLotz.createMint(connection, admin);
  lotz = new LocalLotz(connection, admin, { programId: IDL_PROGRAM_ID, mint, tokenProgram: TOKEN_PROGRAM_ID, treasury: admin.publicKey });
  await lotz.initialize(admin, { basePrice: BASE, tierSize: 1000, tierMultBps: 12_500, maxRect: 10, paused: false });
  await lotz.createShards(admin);
  table = await lotz.createLookupTable(admin);
  alice = await lotz.fundedWallet(1_000_000n * TOKEN);
  bob = await lotz.fundedWallet(1_000_000n * TOKEN);
  carol = await lotz.fundedWallet(1_000_000n * TOKEN);
  await lotz.buy(alice, { x: 0, y: 0, w: 2, h: 2 });
  await lotz.buy(bob, { x: 1, y: 1, w: 2, h: 2 }); // takes one of Alice's lots: she is owed a refund
  await lotz.buy(carol, { x: 50, y: 50, w: 3, h: 1 });
}, 240_000);

afterAll(async () => {
  await validator?.stop();
});

const options = (strandLocked: boolean): WindDownOptions => ({
  connection,
  admin,
  programId: IDL_PROGRAM_ID,
  lookupTable: table,
  strandLocked,
  pollSeconds: 2,
});

describe("wind-down", () => {
  it("refuses while tokens are locked, unless told to leave them in the lock", async () => {
    const plan = await planWindDown(options(false));
    expect(plan.ads).toHaveLength(3);
    expect(plan.lockedLeft).toBeGreaterThan(0n);
    expect(plan.blockers.join(" ")).toMatch(/still locked/);
    await expect(executeWindDown(options(false), plan)).rejects.toThrow(/cannot wind down/);
    expect((await fetchConfig(connection, pdas))!.retired).toBe(false);
  });

  it("closes everything and returns the rent: owners first, then the admin, then the program itself", async () => {
    const plan = await planWindDown(options(true));
    expect(plan.blockers).toEqual([]);
    const lockedBefore = (await connection.getTokenAccountBalance(pdas.lockVault())).value.amount;
    const owners = [alice, bob, carol];
    const ownerBefore = await Promise.all(owners.map((w) => connection.getBalance(w.publicKey)));
    const adRent = new Map<string, number>();
    for (const a of plan.ads) adRent.set(a.ad.owner.toBase58(), (adRent.get(a.ad.owner.toBase58()) ?? 0) + (await connection.getBalance(a.address)));
    const aliceTokens = BigInt((await connection.getTokenAccountBalance(ata(alice.publicKey, lotz.d.mint, TOKEN_PROGRAM_ID))).value.amount);
    const adminBefore = await connection.getBalance(admin.publicKey);

    await executeWindDown(options(true), plan);

    // owners: refund and ad rent
    const aliceAfter = BigInt((await connection.getTokenAccountBalance(ata(alice.publicKey, lotz.d.mint, TOKEN_PROGRAM_ID))).value.amount);
    expect(aliceAfter - aliceTokens).toBe(plan.refundsOwed);
    for (const [i, w] of owners.entries()) {
      expect(await connection.getBalance(w.publicKey)).toBe(ownerBefore[i]! + adRent.get(w.publicKey.toBase58())!);
    }
    // the admin: everything in the plan, less the transaction fees (well under 0.01 SOL)
    const gained = (await connection.getBalance(admin.publicKey)) - adminBefore;
    expect(gained).toBeLessThanOrEqual(plan.toAdmin);
    expect(plan.toAdmin - gained).toBeLessThan(0.01e9);
    expect(plan.toAdmin).toBeGreaterThan(4e9); // program (~3.24 SOL) + shards (~1.21) + the rest

    // nothing left but the lock vault with its tokens (and the records of the weeks still locked)
    const gone = [pdas.config(), pdas.refundVault(), pdas.programData(), table, ...Array.from({ length: 100 }, (_, i) => pdas.shard(i))];
    const infos = [...(await connection.getMultipleAccountsInfo(gone.slice(0, 50))), ...(await connection.getMultipleAccountsInfo(gone.slice(50)))];
    expect(infos.every((a) => a === null)).toBe(true);
    expect((await connection.getTokenAccountBalance(pdas.lockVault())).value.amount).toBe(lockedBefore);
    // and the program cannot run any more
    await expect(lotz.send([lotz.ixs.setPaused(admin.publicKey, false)], [admin])).rejects.toThrow();
  }, 600_000);
});
