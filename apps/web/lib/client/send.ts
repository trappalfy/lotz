/**
 * Transactions go out through the wallet: a wallet that can send does it through its own RPC (none of the site's
 * RPC allowance is spent); others sign, and wallet-adapter sends through the site's RPC. Confirmation comes from the
 * site's live stream when it reports the signature, or from polling, whichever is first.
 */
import {
  AddressLookupTableAccount,
  Connection,
  PublicKey,
  type Commitment,
  type TransactionInstruction,
  type VersionedTransaction,
} from "@solana/web3.js";
import { buildV0, MAX_TX_BYTES } from "@lotz/sdk";

/** wallet-adapter's `sendTransaction` (from `useWallet()`). */
export type SendTx = (
  tx: VersionedTransaction,
  connection: Connection,
  options?: { skipPreflight?: boolean; preflightCommitment?: Commitment; maxRetries?: number },
) => Promise<string>;

const tables = new Map<string, AddressLookupTableAccount>();

export async function lookupTable(connection: Connection, address: string | null): Promise<AddressLookupTableAccount[]> {
  if (!address) return [];
  const cached = tables.get(address);
  if (cached) return [cached];
  const res = await connection.getAddressLookupTable(new PublicKey(address));
  if (!res.value) return [];
  tables.set(address, res.value);
  return [res.value];
}

export class TooLargeError extends Error {
  constructor(readonly size: number) {
    super(`transaction is ${size} bytes, the limit is ${MAX_TX_BYTES}`);
  }
}

/**
 * Simulates `ixs` (signatures not checked, fresh blockhash) and returns the compute units it used, or throws with
 * the program logs if it would fail, before the wallet is asked to sign anything.
 */
export async function simulateUnits(
  connection: Connection,
  payer: PublicKey,
  ixs: TransactionInstruction[],
  lookupTableAddress: string | null,
): Promise<number | null> {
  const alts = await lookupTable(connection, lookupTableAddress);
  // the node puts in a recent blockhash itself
  const tx = buildV0(payer, ixs, PublicKey.default.toBase58(), alts);
  let res;
  try {
    res = await connection.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" });
  } catch {
    return null; // the RPC could not simulate; fall back to the estimate
  }
  if (res.value.err) {
    throw new Error(`simulation failed: ${JSON.stringify(res.value.err)}\n${(res.value.logs ?? []).join("\n")}`);
  }
  return res.value.unitsConsumed ?? null;
}

export interface Blockhash {
  blockhash: string;
  lastValidBlockHeight: number;
}

/** Builds a v0 transaction (with `recent`, or a blockhash fetched now); throws TooLargeError if it cannot fit in one packet. */
export async function prepare(
  connection: Connection,
  payer: PublicKey,
  ixs: TransactionInstruction[],
  lookupTableAddress: string | null,
  recent?: Blockhash,
): Promise<{ tx: VersionedTransaction; blockhash: string; lastValidBlockHeight: number }> {
  const [alts, { blockhash, lastValidBlockHeight }] = await Promise.all([
    lookupTable(connection, lookupTableAddress),
    recent ?? connection.getLatestBlockhash("confirmed"),
  ]);
  const tx = buildV0(payer, ixs, blockhash, alts);
  let size: number;
  try {
    size = tx.serialize().length;
  } catch {
    throw new TooLargeError(MAX_TX_BYTES + 1);
  }
  if (size > MAX_TX_BYTES) throw new TooLargeError(size);
  return { tx, blockhash, lastValidBlockHeight };
}

/**
 * Has the wallet sign and send, then waits until confirmed. `seen(signature)` resolves when the live stream reports
 * the transaction (it only reports ones that succeeded). Returns the signature.
 */
export async function signAndSend(
  connection: Connection,
  send: SendTx,
  prepared: { tx: VersionedTransaction; lastValidBlockHeight: number },
  onStatus?: (s: "signing" | "sending" | "confirming") => void,
  seen?: (signature: string) => Promise<void>,
): Promise<string> {
  onStatus?.("signing");
  const sig = await send(prepared.tx, connection, { skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 5 });
  onStatus?.("confirming");
  await confirmed(connection, sig, prepared.lastValidBlockHeight, seen?.(sig));
  return sig;
}

const POLL_MS = 1_500;

/** Polls the signature (and, now and then, the block height for expiry) until confirmed, or until `seen` resolves. */
export async function confirmed(connection: Connection, sig: string, lastValidBlockHeight: number, seen?: Promise<void>): Promise<void> {
  let streamed = false;
  const wake = seen?.then(() => {
    streamed = true;
  });
  wake?.catch(() => {});
  const started = Date.now();
  for (let round = 1; ; round++) {
    if (streamed) return;
    const st = (await connection.getSignatureStatuses([sig]).catch(() => null))?.value[0];
    if (st?.err) throw new Error(`transaction failed: ${JSON.stringify(st.err)}`);
    if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) return;
    // a blockhash lasts about a minute: check for expiry only every few rounds
    if (round % 5 === 0) {
      const height = await connection.getBlockHeight("confirmed").catch(() => 0);
      if (height > lastValidBlockHeight) throw new Error("block height exceeded");
    }
    if (Date.now() - started > 90_000) throw new Error("block height exceeded");
    await Promise.race([new Promise((r) => setTimeout(r, POLL_MS)), wake].filter(Boolean));
  }
}

export function explorerTx(sig: string, cluster: string): string {
  return `https://solscan.io/tx/${sig}${clusterParam(cluster)}`;
}

export function explorerAccount(address: string, cluster: string): string {
  return `https://solscan.io/account/${address}${clusterParam(cluster)}`;
}

function clusterParam(cluster: string): string {
  if (cluster === "mainnet-beta") return "";
  if (cluster === "devnet") return "?cluster=devnet";
  return `?cluster=custom&customUrl=${encodeURIComponent("http://127.0.0.1:18899")}`;
}
