/** Reading program state over RPC and assembling transactions. */
import {
  AddressLookupTableAccount,
  Connection,
  PublicKey,
  SYSVAR_CLOCK_PUBKEY,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { applyShard, decodeShard, emptyBoard, type BoardLots, type LotState } from "./board";
import { accountDiscriminator, decodeAd, decodeConfig, type AdAccount, type ConfigAccount } from "./coder";
import { MAX_TX_BYTES, SHARD_COUNT } from "./constants";
import { epochAt } from "./math";
import { LotzPdas } from "./pda";

export async function fetchConfig(connection: Connection, pdas: LotzPdas): Promise<ConfigAccount | null> {
  const info = await connection.getAccountInfo(pdas.config(), "confirmed");
  return info ? decodeConfig(info.data) : null;
}

/** Shards by index (missing shards are left out). */
export async function fetchShards(
  connection: Connection,
  pdas: LotzPdas,
  indexes: number[],
): Promise<Map<number, LotState[]>> {
  const out = new Map<number, LotState[]>();
  for (let i = 0; i < indexes.length; i += 100) {
    const chunk = indexes.slice(i, i + 100);
    const infos = await connection.getMultipleAccountsInfo(
      chunk.map((k) => pdas.shard(k)),
      "confirmed",
    );
    infos.forEach((info, j) => {
      if (info) out.set(chunk[j]!, decodeShard(info.data).lots);
    });
  }
  return out;
}

/** The whole board from the chain (100 shards, one RPC call). */
export async function fetchBoard(connection: Connection, pdas: LotzPdas): Promise<BoardLots> {
  const board = emptyBoard();
  const shards = await fetchShards(
    connection,
    pdas,
    Array.from({ length: SHARD_COUNT }, (_, i) => i),
  );
  for (const [index, lots] of shards) applyShard(board, { index, lots });
  return board;
}

/** Offset of `ad_id` in an Ad account (right after the 8-byte discriminator). */
const AD_ID_OFFSET = 8;

function u64le(n: number): Uint8Array {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, BigInt(n), true);
  return b;
}

/** Finds ad accounts by id on-chain (`getProgramAccounts`, one call per id). */
export async function findAds(
  connection: Connection,
  programId: PublicKey,
  adIds: number[],
): Promise<Map<number, { address: PublicKey; ad: AdAccount }>> {
  const disc = accountDiscriminator("Ad");
  const out = new Map<number, { address: PublicKey; ad: AdAccount }>();
  await Promise.all(
    adIds.map(async (id) => {
      const found = await connection.getProgramAccounts(programId, {
        commitment: "confirmed",
        filters: [
          { memcmp: { offset: 0, bytes: bs58(disc) } },
          { memcmp: { offset: AD_ID_OFFSET, bytes: bs58(u64le(id)) } },
        ],
      });
      const first = found[0];
      if (first) out.set(id, { address: first.pubkey, ad: decodeAd(first.account.data) });
    }),
  );
  return out;
}

/** All ad accounts of the program. */
export async function fetchAllAds(
  connection: Connection,
  programId: PublicKey,
): Promise<{ address: PublicKey; ad: AdAccount }[]> {
  const disc = accountDiscriminator("Ad");
  const found = await connection.getProgramAccounts(programId, {
    commitment: "confirmed",
    filters: [{ memcmp: { offset: 0, bytes: bs58(disc) } }],
  });
  return found.map((f) => ({ address: f.pubkey, ad: decodeAd(f.account.data) }));
}

/** The cluster's clock (`unix_timestamp` of the Clock sysvar). */
export async function chainTime(connection: Connection): Promise<number> {
  const info = await connection.getAccountInfo(SYSVAR_CLOCK_PUBKEY, "confirmed");
  if (!info) throw new Error("no clock sysvar");
  return Number(new DataView(info.data.buffer, info.data.byteOffset).getBigInt64(32, true));
}

/**
 * Epoch for a `buy` sent at chain time `now`: the current one, or the next when the boundary is less than
 * `marginSec` away (the program accepts either; the next one locks a few seconds longer).
 */
export function buyEpoch(now: number, config: Pick<ConfigAccount, "launchTs" | "epochLen">, marginSec = 90): number {
  const k = epochAt(now, config.launchTs, config.epochLen);
  const boundary = config.launchTs + (k + 1) * config.epochLen;
  return boundary - now < marginSec ? k + 1 : k;
}

/** A v0 transaction (unsigned). */
export function buildV0(
  payer: PublicKey,
  ixs: TransactionInstruction[],
  recentBlockhash: string,
  lookupTables: AddressLookupTableAccount[] = [],
): VersionedTransaction {
  const message = new TransactionMessage({ payerKey: payer, recentBlockhash, instructions: ixs }).compileToV0Message(
    lookupTables,
  );
  return new VersionedTransaction(message);
}

/** Serialized size in bytes (signatures counted as 64 zero bytes each when unsigned). */
export function txSize(tx: VersionedTransaction): number {
  return tx.serialize().length;
}

export function fitsInOneTx(tx: VersionedTransaction): boolean {
  try {
    return txSize(tx) <= MAX_TX_BYTES;
  } catch {
    return false;
  }
}

// --- base58 for memcmp filters (avoids another dependency)
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function bs58(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let out = "";
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = "1" + out;
  }
  return out;
}
