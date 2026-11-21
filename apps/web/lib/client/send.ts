/** Signing and sending transactions through the wallet, with polled confirmation (no websocket through the proxy). */
import {
  AddressLookupTableAccount,
  Connection,
  PublicKey,
  type TransactionInstruction,
  type VersionedTransaction,
} from "@solana/web3.js";
import { buildV0, MAX_TX_BYTES } from "@lotz/sdk";

export type SignTx = <T extends VersionedTransaction>(tx: T) => Promise<T>;

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
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const tx = buildV0(payer, ixs, blockhash, alts);
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

/** Builds a v0 transaction; throws TooLargeError if it cannot fit in one packet. */
export async function prepare(
  connection: Connection,
  payer: PublicKey,
  ixs: TransactionInstruction[],
  lookupTableAddress: string | null,
): Promise<{ tx: VersionedTransaction; blockhash: string; lastValidBlockHeight: number }> {
  const [alts, { blockhash, lastValidBlockHeight }] = await Promise.all([
    lookupTable(connection, lookupTableAddress),
    connection.getLatestBlockhash("confirmed"),
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

/** Signs with the wallet, sends (preflight on), waits until confirmed. Returns the signature. */
export async function signAndSend(
  connection: Connection,
  sign: SignTx,
  prepared: { tx: VersionedTransaction; lastValidBlockHeight: number },
  onStatus?: (s: "signing" | "sending" | "confirming") => void,
): Promise<string> {
  onStatus?.("signing");
  const signed = await sign(prepared.tx);
  onStatus?.("sending");
  const raw = signed.serialize();
  const sig = await connection.sendRawTransaction(raw, { skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 0 });
  onStatus?.("confirming");
  const started = Date.now();
  let resent = Date.now();
  for (;;) {
    const { value } = await connection.getSignatureStatuses([sig]);
    const st = value[0];
    if (st?.err) throw new Error(`transaction failed: ${JSON.stringify(st.err)}`);
    if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) return sig;
    const height = await connection.getBlockHeight("confirmed");
    if (height > prepared.lastValidBlockHeight) throw new Error("block height exceeded");
    if (Date.now() - resent > 2_000) {
      // rebroadcast until it lands (same signature, so it can only land once)
      void connection.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }).catch(() => {});
      resent = Date.now();
    }
    if (Date.now() - started > 90_000) throw new Error("block height exceeded");
    await new Promise((r) => setTimeout(r, 800));
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
