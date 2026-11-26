/**
 * Close Lotz and get the SOL back. Dry run by default: shows what would happen and how much comes back.
 *
 *   pnpm --filter @lotz/ops wind-down                    # plan only (reads .env.mainnet)
 *   pnpm --filter @lotz/ops wind-down --execute          # does it, after you type CLOSE
 *   ... --strand-locked                                  # even if some tokens are still locked (they stay locked for good)
 *   ... --env <file>                                     # another settings file
 *
 * Owners get their owed refunds and their ad rent back before anything of the admin's closes (the program enforces
 * this order). Locked tokens are never moved early.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Connection, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { formatTokensExact } from "@lotz/sdk";
import { confirmTyped, keypair, repoRoot, sol } from "./common";
import { derive, parseEnvFile } from "./mainnet-env";
import { executeWindDown, planWindDown } from "./wind-down-lib";

const args = process.argv.slice(2).filter((a) => a !== "--");
const execute = args.includes("--execute");
const strandLocked = args.includes("--strand-locked");
const envArg = args[args.indexOf("--env") + 1];
const file = args.includes("--env") && envArg ? resolve(process.env.INIT_CWD ?? process.cwd(), envArg) : resolve(repoRoot(), ".env.mainnet");
const e = derive({ ...(existsSync(file) ? parseEnvFile(file) : {}), ...onlySet(process.env) });
for (const k of ["RPC_URL", "PROGRAM_ID", "ADMIN_KEYPAIR"]) {
  if (!e[k]) {
    console.error(`${k} is missing (looked in ${file} and the environment)`);
    process.exit(1);
  }
}

const connection = new Connection(e.RPC_URL!, "confirmed");
const admin = keypair(resolve(repoRoot(), e.ADMIN_KEYPAIR!));
const options = {
  connection,
  admin,
  programId: new PublicKey(e.PROGRAM_ID!),
  lookupTable: e.LOOKUP_TABLE ? new PublicKey(e.LOOKUP_TABLE) : null,
  strandLocked,
  priority: Number(e.PRIORITY_FEE_MICROLAMPORTS ?? "10000"),
  log: (line: string) => console.log(`  ${line}`),
};

const plan = await planWindDown(options);
const before = await connection.getBalance(admin.publicKey, "confirmed");
const date = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);

console.log(`
Program          ${options.programId.toBase58()}  ${plan.programData ? `(${sol(plan.programData.lamports)} in it)` : "(already closed)"}
Admin            ${admin.publicKey.toBase58()}  balance ${sol(before)}
Board            ${plan.config ? (plan.config.retired ? "retired" : plan.config.paused ? "paused" : "OPEN (will be paused)") : "config already closed"}
Ads              ${plan.ads.length} open; refunds owed to previous owners: ${formatTokensExact(plan.refundsOwed, plan.decimals)} tokens
Lock             ${plan.releasable.length} epochs to release to the treasury now; ${plan.stillLocked.length} still locked${plan.lastUnlock ? ` (last unlock ${date(plan.lastUnlock)})` : ""}
Shards           ${plan.shards.length} to close
Lookup table     ${plan.table ? sol(plan.table.lamports) : "none"}

Back to the admin   ${sol(plan.toAdmin)}   (rent of the program, shards, config, vaults, epoch records, lookup table)
Back to ad owners   ${sol(plan.toOwners)}   (each ad's rent goes to its own owner)
${plan.lockedLeft > 0n ? `Stays locked for good if you continue with --strand-locked: ${formatTokensExact(plan.lockedLeft, plan.decimals)} tokens\n` : ""}`);

if (plan.blockers.length) {
  console.log(`Cannot run now:\n${plan.blockers.map((b) => `  - ${b}`).join("\n")}`);
  process.exit(1);
}
if (!execute) {
  console.log("Dry run. Nothing was sent. Run again with --execute to close Lotz.");
  process.exit(0);
}
if (!(await confirmTyped("CLOSE", "This closes the board and the program for good. The site stops working."))) {
  console.log("Cancelled.");
  process.exit(1);
}
await executeWindDown(options, plan);
const after = await connection.getBalance(admin.publicKey, "confirmed");
console.log(`\nDone. Admin balance ${sol(before)} -> ${sol(after)} (${after >= before ? "+" : ""}${((after - before) / LAMPORTS_PER_SOL).toFixed(4)} SOL).`);

function onlySet(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ["RPC_URL", "PROGRAM_ID", "ADMIN_KEYPAIR", "LOOKUP_TABLE", "PRIORITY_FEE_MICROLAMPORTS"]) {
    if (env[k]) out[k] = env[k]!;
  }
  return out;
}
