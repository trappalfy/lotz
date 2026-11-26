/** Reads program state from the chain: the source of truth the database is reconciled against. */
import { Connection, PublicKey } from "@solana/web3.js";
import {
  LotzPdas,
  accountDiscriminator,
  bs58,
  decodeAd,
  decodeConfig,
  decodeLockEpoch,
  decodeShard,
  type AdAccount,
  type ConfigAccount,
  type LockEpochAccount,
  type LotState,
} from "@lotz/sdk";

export interface TxLogs {
  slot: number;
  blockTime: number | null;
  err: unknown;
  logs: string[];
}

export class Chain {
  readonly pdas: LotzPdas;
  constructor(
    readonly connection: Connection,
    readonly programId: PublicKey,
  ) {
    this.pdas = new LotzPdas(programId);
  }

  /**
   * Slot, time, error and logs of a confirmed transaction, whatever its version: web3.js 1.x refuses version 1
   * transactions (now common on mainnet), so this asks the RPC directly. Null when the RPC does not have it (yet).
   */
  async transaction(signature: string): Promise<TxLogs | null> {
    const res = await fetch(this.connection.rpcEndpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getTransaction",
        params: [signature, { commitment: "confirmed", encoding: "json", maxSupportedTransactionVersion: 1 }],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`getTransaction ${signature}: HTTP ${res.status}`);
    const j = (await res.json()) as {
      result?: { slot: number; blockTime?: number | null; meta?: { err?: unknown; logMessages?: string[] | null } | null } | null;
      error?: { code: number; message: string };
    };
    if (j.error) throw new Error(`getTransaction ${signature}: ${j.error.message}`);
    if (!j.result) return null;
    return {
      slot: j.result.slot,
      blockTime: j.result.blockTime ?? null,
      err: j.result.meta?.err ?? null,
      logs: j.result.meta?.logMessages ?? [],
    };
  }

  async config(): Promise<ConfigAccount | null> {
    const info = await this.connection.getAccountInfo(this.pdas.config(), "confirmed");
    return info ? decodeConfig(info.data) : null;
  }

  async mintDecimals(mint: PublicKey): Promise<number> {
    const info = await this.connection.getAccountInfo(mint, "confirmed");
    if (!info) throw new Error(`mint ${mint.toBase58()} not found`);
    return info.data[44]!;
  }

  /** The token's total supply in base units, as the mint says now. */
  async tokenSupply(mint: PublicKey): Promise<bigint> {
    const r = await this.connection.getTokenSupply(mint, "confirmed");
    return BigInt(r.value.amount);
  }

  /** The program's upgrade authority, or null if the program is immutable. */
  async upgradeAuthority(): Promise<string | null> {
    const info = await this.connection.getAccountInfo(this.pdas.programData(), "confirmed");
    if (!info || info.data.length < 45) return null;
    // ProgramData: u32 tag (3), u64 slot, Option<Pubkey> (u8 tag + 32 bytes)
    if (info.data[12] !== 1) return null;
    return new PublicKey(info.data.subarray(13, 45)).toBase58();
  }

  async shards(indexes: number[]): Promise<Map<number, LotState[]>> {
    const out = new Map<number, LotState[]>();
    for (let i = 0; i < indexes.length; i += 100) {
      const chunk = indexes.slice(i, i + 100);
      const infos = await this.connection.getMultipleAccountsInfo(
        chunk.map((k) => this.pdas.shard(k)),
        "confirmed",
      );
      infos.forEach((info, j) => {
        if (info) out.set(chunk[j]!, decodeShard(info.data).lots);
      });
    }
    return out;
  }

  /** Ad accounts by address; `null` for ones that no longer exist (closed). */
  async ads(addresses: PublicKey[]): Promise<Map<string, AdAccount | null>> {
    const out = new Map<string, AdAccount | null>();
    for (let i = 0; i < addresses.length; i += 100) {
      const chunk = addresses.slice(i, i + 100);
      const infos = await this.connection.getMultipleAccountsInfo(chunk, "confirmed");
      infos.forEach((info, j) => {
        const key = chunk[j]!.toBase58();
        out.set(key, info && info.owner.equals(this.programId) ? decodeAd(info.data) : null);
      });
    }
    return out;
  }

  async allAds(): Promise<{ address: string; ad: AdAccount }[]> {
    const found = await this.connection.getProgramAccounts(this.programId, {
      commitment: "confirmed",
      filters: [{ memcmp: { offset: 0, bytes: bs58(accountDiscriminator("Ad")) } }],
    });
    return found.map((f) => ({ address: f.pubkey.toBase58(), ad: decodeAd(f.account.data) }));
  }

  async allEpochs(): Promise<{ address: string; epoch: LockEpochAccount }[]> {
    const found = await this.connection.getProgramAccounts(this.programId, {
      commitment: "confirmed",
      filters: [{ memcmp: { offset: 0, bytes: bs58(accountDiscriminator("LockEpoch")) } }],
    });
    return found.map((f) => ({ address: f.pubkey.toBase58(), epoch: decodeLockEpoch(f.account.data) }));
  }

  async epoch(k: number): Promise<LockEpochAccount | null> {
    const info = await this.connection.getAccountInfo(this.pdas.epoch(k), "confirmed");
    return info ? decodeLockEpoch(info.data) : null;
  }
}
