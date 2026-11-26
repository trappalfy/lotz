/**
 * Launch rehearsal on a real solana-test-validator (own ports): the lookup table is made for a mint that does not
 * exist yet; the launch waits for it; the mint appears the way pump.fun makes one (created and the whole supply
 * minted in one transaction); then initialize, 100 shards and resuming buying go out, and a purchase works.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Connection, Keypair, SystemProgram, type TransactionInstruction } from "@solana/web3.js";
import {
  MINT_SIZE,
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { IDL_PROGRAM_ID, LotzInstructions, LotzPdas, buildV0, fetchConfig } from "@lotz/sdk";
import { LocalLotz, TOKEN, loadKeypair, startValidator, type RunningValidator } from "@lotz/local";
import {
  PUMP_SUPPLY,
  TRACE,
  blockhashCache,
  createLaunchTable,
  inspectMint,
  launchTableAddresses,
  missingFromTable,
  packLaunch,
  runLaunch,
  waitForAccount,
} from "../src/launch-lib";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
let validator: RunningValidator;
let connection: Connection;
let admin: Keypair;

async function send(ixs: TransactionInstruction[], signers: Keypair[] = []): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const tx = buildV0(admin.publicKey, ixs, blockhash);
  tx.sign([admin, ...signers]);
  const sig = await connection.sendTransaction(tx);
  const res = await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  if (res.value.err) throw new Error(JSON.stringify(res.value.err));
  return sig;
}

beforeAll(async () => {
  admin = loadKeypair(join(ROOT, "keys/dev-wallet.json"));
  validator = await startValidator({
    ledger: mkdtempSync(join(tmpdir(), "lotz-launch-")),
    programSo: join(ROOT, "target/deploy/lotz.so"),
    programId: IDL_PROGRAM_ID,
    upgradeAuthority: admin.publicKey,
    rpcPort: 28899,
    faucetPort: 28990,
    gossipPort: 28001,
    dynamicPortRange: "28100-28200",
    reset: true,
  });
  connection = new Connection(validator.url, "confirmed");
  const sig = await connection.requestAirdrop(admin.publicKey, 100e9);
  await connection.confirmTransaction({ signature: sig, ...(await connection.getLatestBlockhash()) }, "confirmed");
}, 240_000);

afterAll(async () => {
  await validator?.stop();
});

describe("launch", () => {
  it("opens buying within seconds of the mint appearing, in three rounds", async () => {
    const mint = Keypair.generate();
    const treasury = admin.publicKey;

    // the day before: the table, for a mint that does not exist yet
    const addresses = launchTableAddresses(IDL_PROGRAM_ID, mint.publicKey, treasury);
    const table = await createLaunchTable({ connection, admin, addresses, send: (ixs) => send(ixs), log: (m) => console.log(m) });
    expect(missingFromTable(table, addresses)).toEqual([]);

    // the plan, before the mint exists: two transactions, within the limits
    const ixs = new LotzInstructions({ programId: IDL_PROGRAM_ID, mint: mint.publicKey, tokenProgram: TOKEN_2022_PROGRAM_ID, treasury });
    const plan = packLaunch({
      ixs,
      admin: admin.publicKey,
      table,
      initialize: { basePrice: 7_000n * TOKEN, tierSize: 1000, tierMultBps: 12_500, maxRect: 10, paused: true },
      shards: Array.from({ length: 100 }, (_, i) => i),
      open: true,
    });
    expect(plan.flat().map((g) => g.length).reduce((a, b) => a + b)).toBe(102);
    expect(plan.map((round) => round.length)).toEqual([1, 2, 1]);

    // launch day: wait for the mint, check it, launch
    const hashes = blockhashCache(connection, 2_000);
    let seenAt = 0;
    const launched = (async () => {
      const info = await waitForAccount(connection, mint.publicKey, { pollMs: 200 });
      seenAt = Date.now();
      const facts = inspectMint(mint.publicKey, info);
      expect(facts.problems).toEqual([]);
      const sigs = await runLaunch({
        connections: [connection],
        admin,
        programId: IDL_PROGRAM_ID,
        mint: mint.publicKey,
        tokenProgram: facts.tokenProgram,
        treasury,
        params: { basePrice: 7_000n * 10n ** BigInt(facts.decimals), tierSize: 1000, tierMultBps: 12_500, maxRect: 10 },
        open: true,
        table,
        priority: 1_000,
        blockhash: hashes.get,
        log: (m) => console.log(m),
      });
      return { sigs, ms: Date.now() - seenAt };
    })();

    // the token appears: created and the whole supply minted in one transaction, as pump.fun does
    await new Promise((r) => setTimeout(r, 1_500));
    const rent = await connection.getMinimumBalanceForRentExemption(MINT_SIZE);
    const holder = getAssociatedTokenAddressSync(mint.publicKey, admin.publicKey, false, TOKEN_2022_PROGRAM_ID);
    await send(
      [
        SystemProgram.createAccount({ fromPubkey: admin.publicKey, newAccountPubkey: mint.publicKey, lamports: rent, space: MINT_SIZE, programId: TOKEN_2022_PROGRAM_ID }),
        createInitializeMint2Instruction(mint.publicKey, 6, admin.publicKey, null, TOKEN_2022_PROGRAM_ID),
        createAssociatedTokenAccountIdempotentInstruction(admin.publicKey, holder, admin.publicKey, mint.publicKey, TOKEN_2022_PROGRAM_ID),
        createMintToInstruction(mint.publicKey, holder, admin.publicKey, PUMP_SUPPLY, [], TOKEN_2022_PROGRAM_ID),
      ],
      [mint],
    );

    const { sigs, ms } = await launched;
    hashes.stop();
    console.log(`buying open ${ms} ms after the mint was seen, ${sigs.length} transactions`);
    expect(sigs).toHaveLength(4);
    expect(ms).toBeLessThan(15_000);

    // initialize's trace (itself and what it calls) stays within the budget packLaunch gives it
    const first = await connection.getTransaction(sigs[0]!, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    const initIndex = 2; // after the two compute-budget instructions
    const inner = first!.meta!.innerInstructions!.find((x) => x.index === initIndex)?.instructions.length ?? 0;
    console.log(`initialize trace: ${1 + inner}`);
    expect(1 + inner).toBeLessThanOrEqual(TRACE.initialize);

    const config = (await fetchConfig(connection, new LotzPdas(IDL_PROGRAM_ID)))!;
    expect(config.paused).toBe(false);
    expect(config.shardsOpen).toBe(100);
    expect(config.basePrice).toBe(7_000n * TOKEN);

    // a purchase goes through, with the table made the day before
    const lotz = new LocalLotz(connection, admin, { programId: IDL_PROGRAM_ID, mint: mint.publicKey, tokenProgram: TOKEN_2022_PROGRAM_ID, treasury });
    await lotz.loadLookupTable(table.key);
    const buyer = await lotz.fundedWallet(100_000n * TOKEN);
    const { quote } = await lotz.buy(buyer, { x: 99, y: 99, w: 1, h: 1 });
    expect(quote.total).toBe(7_000n * TOKEN);

    // running it again finds nothing to do
    expect(
      await runLaunch({
        connections: [connection],
        admin,
        programId: IDL_PROGRAM_ID,
        mint: mint.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        treasury,
        params: { basePrice: 7_000n * TOKEN, tierSize: 1000, tierMultBps: 12_500, maxRect: 10 },
        open: true,
        table,
        priority: 0,
        blockhash: () => connection.getLatestBlockhash("confirmed"),
      }),
    ).toEqual([]);
  });

  it("names what is wrong with a mint the program would refuse", async () => {
    const mint = Keypair.generate();
    await send(
      [
        SystemProgram.createAccount({
          fromPubkey: admin.publicKey,
          newAccountPubkey: mint.publicKey,
          lamports: await connection.getMinimumBalanceForRentExemption(MINT_SIZE),
          space: MINT_SIZE,
          programId: TOKEN_2022_PROGRAM_ID,
        }),
        createInitializeMint2Instruction(mint.publicKey, 9, admin.publicKey, admin.publicKey, TOKEN_2022_PROGRAM_ID),
      ],
      [mint],
    );
    const info = (await connection.getAccountInfo(mint.publicKey, "confirmed"))!;
    const facts = inspectMint(mint.publicKey, info);
    expect(facts.problems.join("; ")).toMatch(/freeze authority/);
    expect(facts.problems.join("; ")).toMatch(/9 decimals, expected 6/);
    expect(facts.problems.join("; ")).toMatch(/supply 0/);
  });
});
