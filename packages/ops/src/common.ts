import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import {
  AddressLookupTableAccount,
  Connection,
  Keypair,
  PublicKey,
  type TransactionInstruction,
} from "@solana/web3.js";
import { buildV0, computeBudgetIxs } from "@lotz/sdk";

export function need(k: string): string {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is not set`);
  return v;
}

export function repoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
}

/** Loads a keypair file; a relative path is taken from where you ran pnpm (not the package folder). */
export function keypair(path: string): Keypair {
  const full = resolve(process.env.INIT_CWD ?? process.cwd(), path.replace(/^~/, process.env.HOME ?? "~"));
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(full, "utf8")) as number[]));
}

export async function confirmTyped(word: string, prompt: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`${prompt}\nType ${word} to continue: `);
  rl.close();
  return answer.trim() === word;
}

export async function send(
  connection: Connection,
  payer: Keypair,
  ixs: TransactionInstruction[],
  priorityMicroLamports: number,
  tables: AddressLookupTableAccount[] = [],
): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const tx = buildV0(payer.publicKey, [...computeBudgetIxs(400_000, priorityMicroLamports), ...ixs], blockhash, tables);
  tx.sign([payer]);
  const sig = await connection.sendTransaction(tx, { maxRetries: 5 });
  const res = await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  if (res.value.err) throw new Error(`${sig} failed: ${JSON.stringify(res.value.err)}`);
  return sig;
}

export function sol(lamports: number): string {
  return `${(lamports / 1e9).toFixed(4)} SOL`;
}

export { PublicKey };
