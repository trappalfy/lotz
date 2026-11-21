import { PublicKey } from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { SEEDS } from "./constants";

const enc = new TextEncoder();

function u32le(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
}

function u64le(n: bigint): Uint8Array {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, n, true);
  return b;
}

/** Every address the program derives, for one program id. */
export class LotzPdas {
  constructor(readonly programId: PublicKey) {}

  private find(seeds: Uint8Array[]): PublicKey {
    return PublicKey.findProgramAddressSync(seeds, this.programId)[0];
  }

  config(): PublicKey {
    return this.find([enc.encode(SEEDS.config)]);
  }
  lockVault(): PublicKey {
    return this.find([enc.encode(SEEDS.lockVault)]);
  }
  refundVault(): PublicKey {
    return this.find([enc.encode(SEEDS.refundVault)]);
  }
  shard(index: number): PublicKey {
    return this.find([enc.encode(SEEDS.shard), Uint8Array.of(index)]);
  }
  epoch(k: number): PublicKey {
    return this.find([enc.encode(SEEDS.epoch), u32le(k)]);
  }
  ad(owner: PublicKey, nonce: bigint): PublicKey {
    return this.find([enc.encode(SEEDS.ad), owner.toBytes(), u64le(nonce)]);
  }
  /** The program's ProgramData account (upgradeable loader), which holds the upgrade authority. */
  programData(): PublicKey {
    return PublicKey.findProgramAddressSync(
      [this.programId.toBytes()],
      new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111"),
    )[0];
  }
}

export function ata(owner: PublicKey, mint: PublicKey, tokenProgram: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(mint, owner, true, tokenProgram, ASSOCIATED_TOKEN_PROGRAM_ID);
}

/** A random u64 nonce for a new ad's address. */
export function randomNonce(): bigint {
  const b = new Uint8Array(8);
  globalThis.crypto.getRandomValues(b);
  return new DataView(b.buffer).getBigUint64(0, true);
}
