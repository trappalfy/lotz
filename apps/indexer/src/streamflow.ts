/**
 * Tokens locked on Streamflow (strmRq…) for the token, counted with the board's own lock in "locked % of supply".
 * Contracts are found with one getProgramAccounts call (metadata accounts of 1104 bytes, mint at offset 177; the
 * layout is the `Contract` struct of the streamflow-sdk crate, no discriminator). Only contracts the sender cannot
 * cancel count, and only what is not unlocked yet: anyone can create a contract, but a cancelable one is no lock.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { bs58 } from "@lotz/sdk";

export const STREAMFLOW_PROGRAM_ID = new PublicKey("strmRqUCoQUgGUan5YhzUZa6KqdzwX5L6FpUxfmKg5m");
const METADATA_LEN = 1104;
const MINT_OFFSET = 177;
const READ_LEN = 680; // through `closed` at 671

export interface StreamflowLock {
  address: string;
  sender: string;
  recipient: string;
  /** Base units still locked now. */
  locked: string;
  /** When the last of it unlocks (unix seconds). */
  unlockAt: number;
}

export interface StreamflowLocked {
  /** Base units locked on Streamflow now, across counted contracts. */
  total: string;
  contracts: StreamflowLock[];
  at: string;
}

/** What one contract still holds locked at `now`, or null if it does not count (cancelable, canceled, closed). */
export function contractLock(address: string, d: Uint8Array, now: number): StreamflowLock | null {
  if (d.length < READ_LEN) return null;
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const u64 = (o: number) => v.getBigUint64(o, true);
  const canceledAt = u64(25);
  const closed = d[671] === 1;
  const cancelableBySender = d[457] === 1;
  if (closed || canceledAt > 0n || cancelableBySender) return null;
  const endTime = Number(u64(33));
  const startTime = Number(u64(409));
  const deposited = u64(417);
  const period = Number(u64(425));
  const perPeriod = u64(433);
  const cliff = Number(u64(441));
  const cliffAmount = u64(449);
  // unlocked so far (pauses and rate changes ignored: they only unlock less, so this never overstates the lock)
  const start = cliff > 0 ? cliff : startTime;
  let unlocked = 0n;
  if (now >= start) {
    unlocked += cliffAmount;
    if (period > 0) unlocked += BigInt(Math.floor((now - start) / period)) * perPeriod;
  }
  if (unlocked > deposited) unlocked = deposited;
  const locked = deposited - unlocked;
  if (locked <= 0n) return null;
  return {
    address,
    sender: bs58(d.subarray(49, 81)),
    recipient: bs58(d.subarray(113, 145)),
    locked: locked.toString(),
    unlockAt: endTime || cliff,
  };
}

export async function readStreamflowLocks(connection: Connection, mint: PublicKey, now = Math.floor(Date.now() / 1000)): Promise<StreamflowLocked> {
  const accounts = await connection.getProgramAccounts(STREAMFLOW_PROGRAM_ID, {
    commitment: "confirmed",
    filters: [{ dataSize: METADATA_LEN }, { memcmp: { offset: MINT_OFFSET, bytes: mint.toBase58() } }],
    dataSlice: { offset: 0, length: READ_LEN },
  });
  const contracts = accounts
    .map((a) => contractLock(a.pubkey.toBase58(), a.account.data, now))
    .filter((c): c is StreamflowLock => c !== null)
    .sort((a, b) => (BigInt(b.locked) > BigInt(a.locked) ? 1 : -1));
  const total = contracts.reduce((s, c) => s + BigInt(c.locked), 0n);
  return { total: total.toString(), contracts, at: new Date(now * 1000).toISOString() };
}
