/**
 * Launch on a real cluster. Settings come from the environment; with --mainnet, from .env.mainnet as well (the
 * environment wins).
 *
 *   pnpm --filter @lotz/ops launch -- --mainnet                    # plan: checks and cost, sends nothing
 *   pnpm --filter @lotz/ops launch -- --mainnet --table --execute  # the day before: the lookup table for TOKEN_MINT
 *   pnpm --filter @lotz/ops launch -- --mainnet --watch --execute  # launch day: waits for the mint, then launches
 *   pnpm --filter @lotz/ops launch -- --mainnet --execute          # launches now (the mint exists)
 *
 * The launch is four transactions in three rounds, seconds in all: initialize (paused) with the first shards; the
 * other shards; the last shards with buying resumed (START_PAUSED=true leaves it paused). The lookup table must be
 * made beforehand: validators hold back transactions that use a table until its last change is finalized.
 * Safe to re-run: what exists on chain is skipped.
 *
 * Settings: RPC_URL, PROGRAM_ID, TOKEN_MINT, TREASURY, ADMIN_KEYPAIR, LOOKUP_TABLE (for the launch);
 * BASE_PRICE_TOKENS=7000 TIER_SIZE=1000 TIER_MULT_BPS=12500 MAX_RECT=10 START_PAUSED=false;
 * EXPECT_DECIMALS=6 EXPECT_SUPPLY_TOKENS=1000000000 (pump.fun; "any" to skip);
 * LAUNCH_PRIORITY_MICROLAMPORTS=1000000, SEND_RPC_URLS (more RPCs to send through, comma-separated; on mainnet the
 * public one by default); TOKEN_PRICE_USD (only for $ figures in the plan).
 */
import { resolve } from "node:path";
import { Connection, PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { LotzInstructions, SHARD_ACCOUNT_LEN, buildV0, computeBudgetIxs, fetchConfig, formatTokens, formatTokensExact, tierPrice } from "@lotz/sdk";
import { confirmTyped, keypair, repoRoot, sol } from "./common";
import {
  blockhashCache,
  createLaunchTable,
  inspectMint,
  launchState,
  launchTableAddresses,
  missingFromTable,
  runLaunch,
  waitForAccount,
  type MintFacts,
} from "./launch-lib";
import { derive, parseEnvFile } from "./mainnet-env";
import { fullBoardUnits } from "./price";

/** Tier-0 price of a free lot in whole tokens (owner's decision, 2026-11-21); BASE_PRICE_TOKENS overrides it. */
const DEFAULT_BASE_PRICE_TOKENS = 7000;
const MAINNET = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";

const args = process.argv.slice(2);
const execute = args.includes("--execute");
const watch = args.includes("--watch");
const tableMode = args.includes("--table");
const env: Record<string, string | undefined> = {
  ...(args.includes("--mainnet") ? derive(parseEnvFile(resolve(repoRoot(), ".env.mainnet"))) : {}),
  ...Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined && v !== "")),
};
const need = (k: string): string => {
  const v = env[k]?.trim();
  if (!v) throw new Error(`${k} is not set`);
  return v;
};

const connection = new Connection(need("RPC_URL"), { commitment: "confirmed", wsEndpoint: env.RPC_WS_URL || undefined });
const programId = new PublicKey(need("PROGRAM_ID"));
const mint = new PublicKey(need("TOKEN_MINT"));
const treasury = new PublicKey(need("TREASURY"));
// a path from .env.mainnet is relative to the repository; one given on the command line, to where pnpm ran
const admin = keypair(process.env.ADMIN_KEYPAIR || resolve(repoRoot(), need("ADMIN_KEYPAIR")));
const genesis = await connection.getGenesisHash();
const cluster = genesis === MAINNET ? "mainnet-beta" : genesis === "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG" ? "devnet" : "other";
const sendUrls = (env.SEND_RPC_URLS ?? (cluster === "mainnet-beta" ? "https://api.mainnet-beta.solana.com" : ""))
  .split(",")
  .map((u) => u.trim())
  .filter(Boolean);
const connections = [connection, ...sendUrls.map((u) => new Connection(u, "confirmed"))];
const launchPriority = Number(env.LAUNCH_PRIORITY_MICROLAMPORTS ?? 1_000_000);
const tablePriority = Number(env.PRIORITY_FEE_MICROLAMPORTS ?? 10_000);
const expectDecimals = env.EXPECT_DECIMALS === "any" ? undefined : Number(env.EXPECT_DECIMALS ?? 6);
const expectSupplyTokens = env.EXPECT_SUPPLY_TOKENS === "any" ? undefined : BigInt(env.EXPECT_SUPPLY_TOKENS ?? "1000000000");

const baseTokens = env.BASE_PRICE_TOKENS?.trim() || String(DEFAULT_BASE_PRICE_TOKENS);
if (!/^[1-9][0-9]*$/.test(baseTokens)) throw new Error(`BASE_PRICE_TOKENS must be a whole number of tokens, got "${baseTokens}"`);
const tierSize = Number(env.TIER_SIZE ?? 1000);
const tierMultBps = Number(env.TIER_MULT_BPS ?? 12_500);
const maxRect = Number(env.MAX_RECT ?? 10);
const open = (env.START_PAUSED ?? "false") !== "true";
const tokenUsd = Number(env.TOKEN_PRICE_USD ?? "");

// ---------------------------------------------------------------- what is on chain
const pdas = new LotzInstructions({ programId, mint, tokenProgram: TOKEN_2022_PROGRAM_ID, treasury }).pdas;
const programData = await connection.getAccountInfo(pdas.programData());
const authority = programData && programData.data[12] === 1 ? new PublicKey(programData.data.subarray(13, 45)) : null;
const config = await fetchConfig(connection, pdas);
const state = await launchState(connection, pdas);
const balance = await connection.getBalance(admin.publicKey);
const shardRent = await connection.getMinimumBalanceForRentExemption(SHARD_ACCOUNT_LEN);
const treasuryInfo = await connection.getAccountInfo(treasury);
const treasuryOk = !treasuryInfo || treasuryInfo.owner.equals(SystemProgram.programId);
const expect = { decimals: expectDecimals, supply: expectSupplyTokens === undefined ? undefined : expectSupplyTokens * 10n ** BigInt(expectDecimals ?? 6) };
const mintInfo = await connection.getAccountInfo(mint, "confirmed");
const facts = mintInfo ? inspectMint(mint, mintInfo, expect) : null;
const decimals = facts?.decimals ?? expectDecimals ?? 6;
const needed = launchTableAddresses(programId, mint, treasury);
const tableAddress = env.LOOKUP_TABLE ? new PublicKey(env.LOOKUP_TABLE) : null;
const tableFinal = tableAddress ? (await connection.getAddressLookupTable(tableAddress, { commitment: "finalized" })).value : null;
const tableSeen = tableAddress && !tableFinal ? (await connection.getAddressLookupTable(tableAddress, { commitment: "confirmed" })).value : tableFinal;
const tableMissing = tableSeen ? missingFromTable(tableSeen, needed) : needed;
const finalizedSlot = await connection.getSlot("finalized");
const tableReady = !!tableFinal && tableMissing.length === 0 && finalizedSlot > Number(tableFinal.state.lastExtendedSlot);

const basePrice = BigInt(baseTokens) * 10n ** BigInt(decimals);
const top = tierPrice(basePrice, tierMultBps, Math.floor(9_999 / tierSize));
const board = fullBoardUnits(basePrice, tierSize, tierMultBps);
const usd = (units: bigint) =>
  tokenUsd > 0 ? ` (about $${((Number(units) / 10 ** decimals) * tokenUsd).toLocaleString("en-US", { maximumFractionDigits: 2 })})` : "";
const supply = facts?.supply ?? expect.supply;
// rent of the config and both vaults is well under 0.02 SOL; fees with the launch priority about 0.002 SOL
const launchCost = shardRent * state.missingShards.length + (state.initialized ? 0 : 0.02e9) + 0.005e9;

function describeMint(f: MintFacts | null): string {
  if (!f) return "not created yet (--watch waits for it)";
  const kind = f.tokenProgram.equals(TOKEN_2022_PROGRAM_ID) ? "Token-2022" : "SPL Token";
  return [
    `${kind}, ${f.decimals} decimals, supply ${formatTokens(f.supply, f.decimals)}`,
    `mint authority ${f.mintAuthority?.toBase58() ?? "none"}, freeze authority ${f.freezeAuthority?.toBase58() ?? "none"}`,
    `extensions: ${f.extensions.join(", ") || "none"}`,
    ...f.problems.map((p) => `<-- REFUSED: ${p}`),
  ].join("\n                   ");
}

console.log(`
Cluster            ${cluster} (${genesis})
Program            ${programId.toBase58()}  ${programData ? `upgrade authority: ${authority?.toBase58() ?? "none (immutable)"}` : "NOT DEPLOYED"}
Admin (signer)     ${admin.publicKey.toBase58()}  balance ${sol(balance)}
Token              ${mint.toBase58()}
                   ${describeMint(facts)}
Treasury           ${treasury.toBase58()}  (fixed forever)${treasuryOk ? "" : "  <-- not a wallet: initialize will REFUSE it"}
Price              free lot ${formatTokensExact(basePrice, decimals, 6)} tokens at tier 0${usd(basePrice)}, x${tierMultBps / 10_000} every ${tierSize} lots
                   top tier ${formatTokensExact(top, decimals, 6)} tokens${usd(top)}; every free lot sold once: ${formatTokens(board, decimals)} tokens${usd(board)}${supply ? `, ${(Number((board * 10_000n) / supply) / 100).toFixed(1)}% of the supply` : ""}
Rectangle          up to ${maxRect} x ${maxRect}
Buying             ${open ? "opens at the end of the launch" : "stays paused (START_PAUSED=true)"}
Config             ${config ? `initialized, ${config.paused ? "paused" : "buying open"}` : "to create"}
Shards             ${100 - state.missingShards.length}/100 exist; ${state.missingShards.length} to create, rent ${sol(shardRent * state.missingShards.length)}
Lookup table       ${
  !tableAddress
    ? "none yet: make it the day before (--table --execute)"
    : tableReady
      ? `${tableAddress.toBase58()}: ready (${tableFinal!.state.addresses.length} addresses, finalized)`
      : `${tableAddress.toBase58()}: ${!tableSeen ? "NOT FOUND" : tableMissing.length ? `MISSING ${tableMissing.length} addresses` : "not finalized yet, wait a minute"}`
}
Sending            through ${connections.length} RPC${connections.length > 1 ? "s" : ""}, priority ${launchPriority} microlamports/CU
Launch cost        about ${sol(launchCost)} (shard rent, config, vaults, fees)
`);

const refuse = (why: string): never => {
  console.log(`Cannot go on: ${why}`);
  process.exit(1);
};

// ---------------------------------------------------------------- the day before: the lookup table
if (tableMode) {
  if (tableReady) {
    console.log("The lookup table is ready; nothing to do.");
    process.exit(0);
  }
  if (tableAddress && tableSeen && !tableMissing.length) {
    console.log("The lookup table has every address; it is usable once finalized (under a minute).");
    process.exit(0);
  }
  const rent = await connection.getMinimumBalanceForRentExemption(56 + 32 * needed.length);
  console.log(`New lookup table for ${needed.length} addresses: rent ${sol(rent)} (back when it is closed), ${Math.ceil(needed.length / 25) + 1} transactions.`);
  if (!execute) {
    console.log("Dry run. Nothing was sent. Re-run with --execute to create it.");
    process.exit(0);
  }
  if (!(await confirmTyped("TABLE", `This sends transactions on ${cluster} and spends SOL from ${admin.publicKey.toBase58()}.`))) refuse("cancelled");
  const send = async (ixs: Parameters<typeof buildV0>[1]) => {
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    const tx = buildV0(admin.publicKey, [...computeBudgetIxs(50_000, tablePriority), ...ixs], blockhash);
    tx.sign([admin]);
    const sig = await connection.sendTransaction(tx, { maxRetries: 5 });
    const res = await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
    if (res.value.err) throw new Error(`${sig} failed: ${JSON.stringify(res.value.err)}`);
    return sig;
  };
  const table = await createLaunchTable({ connection, admin, addresses: needed, send, log: console.log });
  console.log(`\nDone. Set LOOKUP_TABLE=${table.key.toBase58()} in .env.mainnet, then: pnpm --filter @lotz/ops hosting --apply`);
  process.exit(0);
}

// ---------------------------------------------------------------- the launch
if (!programData) refuse("the program is not deployed");
if (authority && !authority.equals(admin.publicKey)) refuse("ADMIN_KEYPAIR is not the program's upgrade authority; initialize would fail");
if (!authority && !config) refuse("the program is immutable and not initialized: nobody can initialize it");
if (!treasuryOk) refuse("the treasury is not a wallet");
if (config?.retired) refuse("this board is retired");
if (state.initialized && !state.missingShards.length && (!open || !state.paused)) {
  console.log("Launched already; nothing to do.");
  process.exit(0);
}
if (!tableReady) refuse("the lookup table is not ready (make it the day before: --table --execute, then set LOOKUP_TABLE)");
if (facts?.problems.length) refuse(`the mint: ${facts.problems.join("; ")}`);
if (!facts && !watch) refuse("the mint does not exist yet: --watch waits for it");
if (balance < launchCost) refuse(`${admin.publicKey.toBase58()} has ${sol(balance)}, the launch needs about ${sol(launchCost)}`);
if (!execute) {
  console.log(`Dry run. Nothing was sent. Re-run with --execute${facts ? "" : " --watch"} to launch.`);
  process.exit(0);
}
if (!(await confirmTyped("LAUNCH", `This sends transactions on ${cluster} and spends SOL from ${admin.publicKey.toBase58()}${facts ? "" : ", as soon as the mint appears"}.`))) refuse("cancelled");

const hashes = blockhashCache(connection);
let info = mintInfo;
if (!info) {
  console.log(`Waiting for ${mint.toBase58()} ... (Ctrl+C to stop)`);
  const t0 = Date.now();
  const heartbeat = setInterval(() => console.log(`  still waiting, ${Math.round((Date.now() - t0) / 60_000)} min`), 60_000);
  info = await waitForAccount(connection, mint, { pollMs: 1_000 });
  clearInterval(heartbeat);
}
const seenAt = Date.now();
const seen = inspectMint(mint, info, expect);
console.log(`\nMint seen: ${describeMint(seen)}`);
if (seen.problems.length) refuse(`the mint: ${seen.problems.join("; ")}. Nothing was sent.`);

const sigs = await runLaunch({
  connections,
  admin,
  programId,
  mint,
  tokenProgram: seen.tokenProgram,
  treasury,
  params: { basePrice: BigInt(baseTokens) * 10n ** BigInt(seen.decimals), tierSize, tierMultBps, maxRect },
  open,
  table: tableFinal!,
  priority: launchPriority,
  blockhash: hashes.get,
  log: console.log,
});
hashes.stop();
const after = await launchState(connection, pdas);
console.log(
  `\nDone in ${((Date.now() - seenAt) / 1000).toFixed(1)} s after the mint appeared, ${sigs.length} transactions. ` +
    `Shards ${100 - after.missingShards.length}/100, buying ${after.paused ? "paused (resume: pnpm --filter @lotz/ops pause false)" : "open"}.`,
);
process.exit(0);
