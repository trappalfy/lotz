/** Instruction builders. Account order comes from the IDL, so it cannot drift from the program. */
import {
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  type AccountMeta,
} from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { shardsForRect } from "./board";
import {
  encodeBuy,
  encodeClaimRefund,
  encodeCloseAd,
  encodeInitialize,
  encodeInitShard,
  encodeReleaseEpoch,
  encodeRetire,
  encodeRetireConfig,
  encodeRetireEpoch,
  encodeRetireShards,
  encodeSetPaused,
  instructionAccounts,
  type BuyArgs,
  type InitParams,
} from "./coder";
import { LotzPdas, ata } from "./pda";

/** Everything the builders need to know about one deployment. */
export interface LotzDeployment {
  programId: PublicKey;
  mint: PublicKey;
  tokenProgram: PublicKey;
  treasury: PublicKey;
}

function build(
  programId: PublicKey,
  name: string,
  keys: Record<string, PublicKey>,
  data: Buffer,
  remaining: AccountMeta[] = [],
): TransactionInstruction {
  const metas: AccountMeta[] = instructionAccounts(name).map((a) => {
    const pubkey = keys[a.name];
    if (!pubkey) throw new Error(`${name}: missing account ${a.name}`);
    return { pubkey, isWritable: a.writable, isSigner: a.signer };
  });
  return new TransactionInstruction({ programId, keys: [...metas, ...remaining], data });
}

export class LotzInstructions {
  readonly pdas: LotzPdas;

  constructor(readonly d: LotzDeployment) {
    this.pdas = new LotzPdas(d.programId);
  }

  initialize(admin: PublicKey, params: InitParams): TransactionInstruction {
    return build(
      this.d.programId,
      "initialize",
      {
        admin,
        config: this.pdas.config(),
        token_mint: this.d.mint,
        treasury: this.d.treasury,
        lock_vault: this.pdas.lockVault(),
        refund_vault: this.pdas.refundVault(),
        lotz_program: this.d.programId,
        program_data: this.pdas.programData(),
        token_program: this.d.tokenProgram,
        system_program: SystemProgram.programId,
      },
      encodeInitialize(params),
    );
  }

  initShard(admin: PublicKey, index: number): TransactionInstruction {
    return build(
      this.d.programId,
      "init_shard",
      { admin, config: this.pdas.config(), shard: this.pdas.shard(index), system_program: SystemProgram.programId },
      encodeInitShard(index),
    );
  }

  /** `priorAds`: addresses of every ad that loses a lot in the rectangle. */
  buy(buyer: PublicKey, args: BuyArgs, priorAds: PublicKey[]): TransactionInstruction {
    const shards = shardsForRect(args).map((i) => ({
      pubkey: this.pdas.shard(i),
      isWritable: true,
      isSigner: false,
    }));
    const prior = priorAds.map((pubkey) => ({ pubkey, isWritable: true, isSigner: false }));
    return build(
      this.d.programId,
      "buy",
      {
        buyer,
        config: this.pdas.config(),
        token_mint: this.d.mint,
        buyer_token: ata(buyer, this.d.mint, this.d.tokenProgram),
        lock_vault: this.pdas.lockVault(),
        refund_vault: this.pdas.refundVault(),
        lock_epoch: this.pdas.epoch(args.epoch),
        ad: this.pdas.ad(buyer, args.nonce),
        token_program: this.d.tokenProgram,
        system_program: SystemProgram.programId,
      },
      encodeBuy(args),
      [...shards, ...prior],
    );
  }

  /** The owner claims; once the board is retired anyone (`caller`) can send an owner's refund to them. */
  claimRefund(caller: PublicKey, ad: PublicKey, owner: PublicKey = caller): TransactionInstruction {
    return build(
      this.d.programId,
      "claim_refund",
      {
        caller,
        config: this.pdas.config(),
        token_mint: this.d.mint,
        ad,
        owner,
        refund_vault: this.pdas.refundVault(),
        owner_token: ata(owner, this.d.mint, this.d.tokenProgram),
        token_program: this.d.tokenProgram,
        associated_token_program: ASSOCIATED_TOKEN_PROGRAM_ID,
        system_program: SystemProgram.programId,
      },
      encodeClaimRefund(),
    );
  }

  /** The owner closes an empty ad; once the board is retired anyone can close any ad. The rent goes to `owner`. */
  closeAd(caller: PublicKey, ad: PublicKey, owner: PublicKey = caller): TransactionInstruction {
    return build(this.d.programId, "close_ad", { caller, config: this.pdas.config(), ad, owner }, encodeCloseAd());
  }

  releaseEpoch(caller: PublicKey, epoch: number): TransactionInstruction {
    return build(
      this.d.programId,
      "release_epoch",
      {
        caller,
        config: this.pdas.config(),
        token_mint: this.d.mint,
        lock_epoch: this.pdas.epoch(epoch),
        lock_vault: this.pdas.lockVault(),
        treasury: this.d.treasury,
        treasury_token: ata(this.d.treasury, this.d.mint, this.d.tokenProgram),
        token_program: this.d.tokenProgram,
        associated_token_program: ASSOCIATED_TOKEN_PROGRAM_ID,
        system_program: SystemProgram.programId,
      },
      encodeReleaseEpoch(epoch),
    );
  }

  setPaused(admin: PublicKey, paused: boolean): TransactionInstruction {
    return build(this.d.programId, "set_paused", { admin, config: this.pdas.config() }, encodeSetPaused(paused));
  }

  /** Admin, buying paused: retires the board for good (the first step of winding it down). */
  retire(admin: PublicKey): TransactionInstruction {
    return build(this.d.programId, "retire", { admin, config: this.pdas.config() }, encodeRetire());
  }

  /** Admin, once retired: closes a released epoch record. */
  retireEpoch(admin: PublicKey, epoch: number): TransactionInstruction {
    return build(
      this.d.programId,
      "retire_epoch",
      { admin, config: this.pdas.config(), lock_epoch: this.pdas.epoch(epoch) },
      encodeRetireEpoch(epoch),
    );
  }

  /** Admin, once retired: closes the given shards. */
  retireShards(admin: PublicKey, indexes: number[]): TransactionInstruction {
    const shards = indexes.map((i) => ({ pubkey: this.pdas.shard(i), isWritable: true, isSigner: false }));
    return build(this.d.programId, "retire_shards", { admin, config: this.pdas.config() }, encodeRetireShards(), shards);
  }

  /** Admin, once retired, no ad or shard left: closes the empty vaults and the config. */
  retireConfig(admin: PublicKey): TransactionInstruction {
    return build(
      this.d.programId,
      "retire_config",
      {
        admin,
        config: this.pdas.config(),
        lock_vault: this.pdas.lockVault(),
        refund_vault: this.pdas.refundVault(),
        token_program: this.d.tokenProgram,
      },
      encodeRetireConfig(),
    );
  }

  /**
   * Addresses that never change for a deployment: put them in an address lookup table so a `buy` with many prior
   * ads still fits in one transaction. (Program ids that are invoked cannot come from a table.)
   */
  lookupTableAddresses(): PublicKey[] {
    const out = [
      this.pdas.config(),
      this.d.mint,
      this.d.tokenProgram,
      this.pdas.lockVault(),
      this.pdas.refundVault(),
      SystemProgram.programId,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    ];
    for (let i = 0; i < 100; i++) out.push(this.pdas.shard(i));
    return out;
  }
}

/**
 * Fallback compute-unit limit for a `buy` when it cannot be simulated. LiteSVM worst case (100 lots, 16 prior ads
 * with the longest content, Token-2022): ~148k CU; each prior ad costs up to ~6k.
 */
export function buyComputeUnits(lots: number, priorAds: number): number {
  return Math.min(400_000, 60_000 + 400 * lots + 7_000 * priorAds + 25_000);
}

export function computeBudgetIxs(units: number, microLamportsPerCu: number): TransactionInstruction[] {
  const ixs = [ComputeBudgetProgram.setComputeUnitLimit({ units })];
  if (microLamportsPerCu > 0) ixs.push(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: microLamportsPerCu }));
  return ixs;
}
