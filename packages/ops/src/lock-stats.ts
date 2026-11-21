/**
 * How much of the token supply is in the lock, read straight from the chain (not from our database), and a
 * ready-to-post text. Read-only.
 *
 *   pnpm --filter @lotz/ops lock-stats [--json] [path/to/env file]     (default: .env.mainnet)
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Connection, PublicKey } from "@solana/web3.js";
import { LotzPdas, TOTAL_LOTS, fetchConfig, formatCompact, formatInt, formatShare, formatTokens, shareOfSupply } from "@lotz/sdk";
import { repoRoot } from "./common";
import { derive, parseEnvFile } from "./mainnet-env";

const args = process.argv.slice(2).filter((a) => a !== "--");
const json = args.includes("--json");
const fileArg = args.find((a) => !a.startsWith("--"));
const file = fileArg ? resolve(process.env.INIT_CWD ?? process.cwd(), fileArg) : resolve(repoRoot(), ".env.mainnet");
const e = derive({ ...(existsSync(file) ? parseEnvFile(file) : {}), ...pickEnv(["RPC_URL", "PROGRAM_ID", "SITE_DOMAIN"]) });
if (!e.RPC_URL || !e.PROGRAM_ID) {
  console.error(`RPC_URL (or HELIUS_API_KEY) and PROGRAM_ID are needed; looked in ${file} and the environment.`);
  process.exit(1);
}

const connection = new Connection(e.RPC_URL, "confirmed");
const pdas = new LotzPdas(new PublicKey(e.PROGRAM_ID));
const config = await fetchConfig(connection, pdas);
if (!config) {
  console.error("Lotz is not initialized on this cluster yet.");
  process.exit(1);
}
const [supplyRes, vaultRes, mintInfo] = await Promise.all([
  connection.getTokenSupply(config.tokenMint, "confirmed"),
  connection.getTokenAccountBalance(pdas.lockVault(), "confirmed"),
  connection.getAccountInfo(config.tokenMint, "confirmed"),
]);
if (!mintInfo) throw new Error("mint not found");
const decimals = supplyRes.value.decimals;
const supply = BigInt(supplyRes.value.amount);
const lockedNow = config.totalLocked - config.totalReleased;
const vault = BigInt(vaultRes.value.amount);
const share = formatShare(lockedNow, supply);
const site = e.SITE_DOMAIN ? e.SITE_DOMAIN.replace(/^https?:\/\//, "") : "lotz.fun";
const card = e.STORAGE_PUBLIC_URL ? `${e.STORAGE_PUBLIC_URL}/share/lock.png` : null;

const post = [
  `${share} of the supply is locked on Lotz.`,
  "",
  `${formatCompact(lockedNow, decimals)} tokens in the lock after ${formatInt(config.lotsSold)} lots sold and ${formatInt(Number(config.takeovers))} takeovers. Each week's lock opens 365 days later, to the treasury.`,
  "",
  site,
].join("\n");

if (json) {
  console.log(
    JSON.stringify(
      {
        mint: config.tokenMint.toBase58(),
        decimals,
        supply: supply.toString(),
        lockedNow: lockedNow.toString(),
        lockVaultBalance: vault.toString(),
        share: shareOfSupply(lockedNow, supply),
        sharePercent: share,
        totalLocked: config.totalLocked.toString(),
        totalReleased: config.totalReleased.toString(),
        lotsSold: config.lotsSold,
        takeovers: Number(config.takeovers),
        card,
        post,
      },
      null,
      2,
    ),
  );
} else {
  console.log(`Token supply      ${formatTokens(supply, decimals)}
In the lock now   ${formatTokens(lockedNow, decimals)}  = ${share} of the supply
Lock vault        ${formatTokens(vault, decimals)}  ${vault === lockedNow ? "(matches the program's counters)" : "(DIFFERS from the counters: check)"}
Ever locked       ${formatTokens(config.totalLocked, decimals)}, released ${formatTokens(config.totalReleased, decimals)}
Lots sold         ${formatInt(config.lotsSold)} / ${formatInt(TOTAL_LOTS)}, takeovers ${formatInt(Number(config.takeovers))}
${card ? `Card              ${card}\n` : ""}
Post:
${post}`);
}

function pickEnv(keys: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of keys) if (process.env[k]) out[k] = process.env[k]!;
  return out;
}
