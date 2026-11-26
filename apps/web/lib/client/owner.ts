/** Owner actions: claim refunds, close empty ads. */
import { Connection, PublicKey, type TransactionInstruction } from "@solana/web3.js";
import { computeBudgetIxs, type LotzInstructions } from "@lotz/sdk";
import { prepare, signAndSend, type SendTx } from "./send";

async function run(
  connection: Connection,
  owner: PublicKey,
  send: SendTx,
  ixs: TransactionInstruction[],
  lookupTable: string | null,
  units: number,
): Promise<string> {
  const prepared = await prepare(connection, owner, [...computeBudgetIxs(units, 0), ...ixs], lookupTable);
  return signAndSend(connection, send, prepared);
}

/** Claims refunds of several ads, four per transaction (each needs its own signature from the wallet). */
export async function claimRefunds(
  connection: Connection,
  lotz: LotzInstructions,
  owner: PublicKey,
  send: SendTx,
  ads: PublicKey[],
  lookupTable: string | null,
): Promise<string[]> {
  const sigs: string[] = [];
  for (let i = 0; i < ads.length; i += 4) {
    const chunk = ads.slice(i, i + 4);
    sigs.push(await run(connection, owner, send, chunk.map((ad) => lotz.claimRefund(owner, ad)), lookupTable, 40_000 * chunk.length + 30_000));
  }
  return sigs;
}

export async function closeAds(
  connection: Connection,
  lotz: LotzInstructions,
  owner: PublicKey,
  send: SendTx,
  ads: PublicKey[],
  lookupTable: string | null,
): Promise<string[]> {
  const sigs: string[] = [];
  for (let i = 0; i < ads.length; i += 8) {
    const chunk = ads.slice(i, i + 8);
    sigs.push(await run(connection, owner, send, chunk.map((ad) => lotz.closeAd(owner, ad)), lookupTable, 10_000 * chunk.length + 10_000));
  }
  return sigs;
}
