/**
 * Launch on a real cluster: initialize Lotz, create the 100 shards and the lookup table.
 *
 *   RPC_URL=... PROGRAM_ID=... TOKEN_MINT=... TREASURY=... ADMIN_KEYPAIR=<owner keypair.json> \
 *   BASE_PRICE_USD=5 TOKEN_PRICE_USD=<token price now> TIER_SIZE=1000 TIER_MULT_BPS=12500 MAX_RECT=10 START_PAUSED=true \
 *   pnpm --filter @lotz/ops launch            # dry run: checks and prints the plan and its cost
 *   pnpm --filter @lotz/ops launch --execute  # sends, after you type LAUNCH
 *
 * Safe to re-run: finished steps are skipped (an initialized config, existing shards, an existing table given in
 * LOOKUP_TABLE).
 */
import { AddressLookupTableProgram, Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getMint, getMintCloseAuthority, getExtensionTypes } from "@solana/spl-token";
import { SystemProgram } from "@solana/web3.js";
import { LotzInstructions, SHARD_ACCOUNT_LEN, tierPrice, fetchConfig, formatTokens, formatTokensExact } from "@lotz/sdk";
import { confirmTyped, keypair, need, send, sol } from "./common";
import { basePriceUnits, fullBoardUnits } from "./price";

const execute = process.argv.includes("--execute");
const connection = new Connection(need("RPC_URL"), "confirmed");
const programId = new PublicKey(need("PROGRAM_ID"));
const mint = new PublicKey(need("TOKEN_MINT"));
const treasury = new PublicKey(need("TREASURY"));
const admin = keypair(need("ADMIN_KEYPAIR"));
const priority = Number(process.env.PRIORITY_FEE_MICROLAMPORTS ?? "10000");

const mintInfo = await connection.getAccountInfo(mint);
if (!mintInfo) throw new Error("mint not found");
const tokenProgram = mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
const m = await getMint(connection, mint, "confirmed", tokenProgram);
const decimals = m.decimals;
// the price of a free lot: in dollars at today's token price (BASE_PRICE_USD + TOKEN_PRICE_USD), or in whole tokens
const lotUsd = Number(process.env.BASE_PRICE_USD ?? "");
const tokenUsd = Number(process.env.TOKEN_PRICE_USD ?? "");
if (!process.env.BASE_PRICE_TOKENS && !(lotUsd > 0 && tokenUsd > 0)) {
  throw new Error("set BASE_PRICE_USD and TOKEN_PRICE_USD (or BASE_PRICE_TOKENS)");
}
const basePrice = process.env.BASE_PRICE_TOKENS
  ? BigInt(process.env.BASE_PRICE_TOKENS) * 10n ** BigInt(decimals)
  : basePriceUnits(lotUsd, tokenUsd, decimals);
const params = {
  basePrice,
  tierSize: Number(process.env.TIER_SIZE ?? 1000),
  tierMultBps: Number(process.env.TIER_MULT_BPS ?? 12_500),
  maxRect: Number(process.env.MAX_RECT ?? 10),
  paused: (process.env.START_PAUSED ?? "true") === "true",
};
const ixs = new LotzInstructions({ programId, mint, tokenProgram, treasury });

// ---- checks
const genesis = await connection.getGenesisHash();
const cluster = genesis === "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d" ? "mainnet-beta" : genesis === "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG" ? "devnet" : "other";
const programData = await connection.getAccountInfo(ixs.pdas.programData());
const authority = programData && programData.data[12] === 1 ? new PublicKey(programData.data.subarray(13, 45)) : null;
const config = await fetchConfig(connection, ixs.pdas);
const shardInfos = await connection.getMultipleAccountsInfo(Array.from({ length: 100 }, (_, i) => ixs.pdas.shard(i)));
const missingShards = shardInfos.flatMap((s, i) => (s ? [] : [i]));
const shardRent = await connection.getMinimumBalanceForRentExemption(SHARD_ACCOUNT_LEN);
const balance = await connection.getBalance(admin.publicKey);
const closeAuthority = getMintCloseAuthority(m)?.closeAuthority;
const extensions = m.tlvData.length ? getExtensionTypes(m.tlvData) : [];
const treasuryInfo = await connection.getAccountInfo(treasury);
const treasuryOk = !treasuryInfo || treasuryInfo.owner.equals(SystemProgram.programId);
const top = tierPrice(basePrice, params.tierMultBps, Math.floor(9_999 / params.tierSize));
const board = fullBoardUnits(basePrice, params.tierSize, params.tierMultBps);
function usd(units: bigint): string {
  if (!(tokenUsd > 0)) return "";
  const value = (Number(units) / 10 ** decimals) * tokenUsd;
  return ` (about $${value.toLocaleString("en-US", { maximumFractionDigits: 2 })})`;
}

console.log(`
Cluster            ${cluster} (${genesis})
Program            ${programId.toBase58()}  upgrade authority: ${authority?.toBase58() ?? "none (immutable)"}
Admin (signer)     ${admin.publicKey.toBase58()}  balance ${sol(balance)}
Token              ${mint.toBase58()}  ${tokenProgram.equals(TOKEN_2022_PROGRAM_ID) ? "Token-2022" : "SPL Token"}, ${decimals} decimals
                   freeze authority: ${m.freezeAuthority?.toBase58() ?? "none"}${m.freezeAuthority ? "  <-- initialize will REFUSE this mint" : ""}
                   extensions: ${extensions.length ? extensions.join(", ") : "none"}; close authority: ${closeAuthority && !closeAuthority.equals(PublicKey.default) ? `${closeAuthority.toBase58()}  <-- initialize will REFUSE this mint` : "none"}
Treasury           ${treasury.toBase58()}  (fixed forever)${treasuryOk ? "" : "  <-- not a wallet: initialize will REFUSE it"}
Price              free lot ${formatTokensExact(params.basePrice, decimals, 6)} tokens at tier 0${usd(params.basePrice)}, x${params.tierMultBps / 10_000} every ${params.tierSize} lots
                   top tier ${formatTokensExact(top, decimals, 6)} tokens${usd(top)}; every free lot sold once: ${formatTokens(board, decimals)} tokens${usd(board)}
                   (fixed in tokens forever; dollar figures are at ${tokenUsd > 0 ? `$${tokenUsd} per token` : "an unknown token price"})
Rectangle          up to ${params.maxRect} x ${params.maxRect}
Start paused       ${params.paused}
Config             ${config ? "already initialized" : "to create"}
Shards             ${100 - missingShards.length}/100 exist; ${missingShards.length} to create, rent ${sol(shardRent * missingShards.length)}
Lookup table       ${process.env.LOOKUP_TABLE ? `given: ${process.env.LOOKUP_TABLE}` : "to create (~0.02 SOL)"}
`);
if (authority && !authority.equals(admin.publicKey)) throw new Error("ADMIN_KEYPAIR is not the program's upgrade authority; initialize would fail");
if (!authority && !config) throw new Error("the program is immutable and not initialized: nobody can initialize it");
if (!execute) {
  console.log("Dry run. Nothing was sent. Re-run with --execute to send these transactions.");
  process.exit(0);
}
if (!(await confirmTyped("LAUNCH", `This sends transactions on ${cluster} and spends SOL from ${admin.publicKey.toBase58()}.`))) {
  console.log("Cancelled.");
  process.exit(1);
}

if (!config) {
  console.log("initialize:", await send(connection, admin, [ixs.initialize(admin.publicKey, params)], priority));
}
for (let i = 0; i < missingShards.length; i += 8) {
  const batch = missingShards.slice(i, i + 8);
  console.log(`shards ${batch.join(",")}:`, await send(connection, admin, batch.map((k) => ixs.initShard(admin.publicKey, k)), priority));
}
if (!process.env.LOOKUP_TABLE) {
  const slot = await connection.getSlot("finalized");
  const [create, table] = AddressLookupTableProgram.createLookupTable({ authority: admin.publicKey, payer: admin.publicKey, recentSlot: slot });
  console.log("lookup table:", table.toBase58(), await send(connection, admin, [create], priority));
  const addresses = ixs.lookupTableAddresses();
  for (let i = 0; i < addresses.length; i += 25) {
    const extend = AddressLookupTableProgram.extendLookupTable({ lookupTable: table, authority: admin.publicKey, payer: admin.publicKey, addresses: addresses.slice(i, i + 25) });
    console.log(`  extend ${i}:`, await send(connection, admin, [extend], priority));
  }
  console.log(`\nSet LOOKUP_TABLE=${table.toBase58()} in the site's .env.`);
}
console.log(params.paused ? "\nDone. Buying is paused: resume with `pnpm --filter @lotz/ops pause false`." : "\nDone.");
