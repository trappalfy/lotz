/** `pnpm localnet:fund <wallet> [tokens]`: SOL and test tokens for a wallet on the local validator. */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { LocalLotz, TOKEN, assertLocal, loadKeypair } from "../index";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const RPC = "http://127.0.0.1:18899";

const [wallet, amount = "10000000"] = process.argv.slice(2);
if (!wallet) {
  console.error("usage: pnpm localnet:fund <wallet> [tokens]");
  process.exit(1);
}
assertLocal(RPC);
const state = JSON.parse(readFileSync(join(ROOT, ".data/localnet.json"), "utf8")) as { programId: string; mint: string; treasury: string };
const admin = loadKeypair(join(ROOT, "keys/dev-wallet.json"));
const lotz = new LocalLotz(new Connection(RPC, "confirmed"), admin, {
  programId: new PublicKey(state.programId),
  mint: new PublicKey(state.mint),
  tokenProgram: TOKEN_PROGRAM_ID,
  treasury: new PublicKey(state.treasury),
});
await lotz.fund(new PublicKey(wallet), BigInt(amount) * TOKEN, 10);
console.log(`funded ${wallet}: 10 SOL and ${amount} tokens`);
