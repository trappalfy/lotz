/**
 * Winding Lotz down and getting the SOL back, in the order the program enforces:
 *
 *  1. pause buying; release every epoch whose year is up (to the treasury);
 *  2. retire the board (for good);
 *  3. send every owed refund to its owner, close every ad (rent back to each owner);
 *  4. close released epoch records, the 100 shards, the empty vaults and the config (rent to the admin);
 *  5. deactivate and close the lookup table (rent to the admin);
 *  6. close the program itself (its rent to the admin).
 *
 * Every step first looks at the chain, so a run that stops halfway can simply be started again.
 * Tokens still locked (epochs not yet a year old) can never be moved by any of this: by default the wind-down stops
 * and says when the last one unlocks; with `strandLocked` they stay in the lock vault for good.
 */
import {
  AddressLookupTableProgram,
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  LotzInstructions,
  LotzPdas,
  accountDiscriminator,
  bs58,
  chainTime,
  decodeLockEpoch,
  fetchAllAds,
  fetchConfig,
  formatTokensExact,
  type AdAccount,
  type ConfigAccount,
  type LockEpochAccount,
} from "@lotz/sdk";
import { send } from "./common";

export const UPGRADEABLE_LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
/** A deactivated lookup table can be closed once its deactivation slot leaves the slot hashes (512 slots). */
const ALT_COOLDOWN_SLOTS = 513;

export interface WindDownOptions {
  connection: Connection;
  admin: Keypair;
  programId: PublicKey;
  lookupTable: PublicKey | null;
  /** Retire even though some tokens are still locked; they then stay in the lock vault for good. */
  strandLocked?: boolean;
  priority?: number;
  log?: (line: string) => void;
  /** Seconds between checks while waiting for the lookup table to cool down. */
  pollSeconds?: number;
}

export interface WindDownPlan {
  config: ConfigAccount | null;
  ads: { address: PublicKey; ad: AdAccount }[];
  epochs: { address: PublicKey; epoch: LockEpochAccount }[];
  /** Unreleased epochs whose year is up: released to the treasury first. */
  releasable: number[];
  /** Unreleased epochs still in their year. */
  stillLocked: number[];
  lockedLeft: bigint;
  lastUnlock: number | null;
  shards: number[];
  lockVault: { lamports: number; amount: bigint } | null;
  refundVault: { lamports: number; amount: bigint } | null;
  programData: { address: PublicKey; lamports: number; authority: PublicKey | null } | null;
  table: { lamports: number; authority: PublicKey | null; deactivating: boolean } | null;
  /** Lamports that come back to the admin. */
  toAdmin: number;
  /** Lamports that go back to ad owners (their ad rent). */
  toOwners: number;
  /** Tokens paid out to previous owners (refunds still owed). */
  refundsOwed: bigint;
  /** Why the wind-down cannot run now (empty when it can). */
  blockers: string[];
  /** The token's decimals (for display), 0 if the config is gone. */
  decimals: number;
}

async function programAccounts(connection: Connection, programId: PublicKey, name: "LockEpoch") {
  return connection.getProgramAccounts(programId, {
    commitment: "confirmed",
    filters: [{ memcmp: { offset: 0, bytes: bs58(accountDiscriminator(name)) } }],
  });
}

async function tokenAmount(connection: Connection, address: PublicKey): Promise<{ lamports: number; amount: bigint } | null> {
  const info = await connection.getAccountInfo(address, "confirmed");
  if (!info) return null;
  return { lamports: info.lamports, amount: info.data.readBigUInt64LE(64) };
}

export async function planWindDown(o: WindDownOptions): Promise<WindDownPlan> {
  const { connection, programId } = o;
  const pdas = new LotzPdas(programId);
  const [config, ads, epochAccounts, now] = await Promise.all([
    fetchConfig(connection, pdas),
    fetchAllAds(connection, programId),
    programAccounts(connection, programId, "LockEpoch"),
    chainTime(connection),
  ]);
  const epochs = epochAccounts.map((a) => ({ address: a.pubkey, epoch: decodeLockEpoch(a.account.data) }));
  const decimals = config ? (await connection.getTokenSupply(config.tokenMint, "confirmed")).value.decimals : 0;
  const unreleased = epochs.filter((e) => !e.epoch.released);
  const releasable = unreleased.filter((e) => e.epoch.unlockAt <= now).map((e) => e.epoch.epoch);
  const locked = unreleased.filter((e) => e.epoch.unlockAt > now);
  const lockedLeft = locked.reduce((s, e) => s + e.epoch.amount, 0n);
  const lastUnlock = locked.length ? Math.max(...locked.map((e) => e.epoch.unlockAt)) : null;

  const shardInfos = await connection.getMultipleAccountsInfo(
    Array.from({ length: 100 }, (_, i) => pdas.shard(i)),
    "confirmed",
  );
  const shards = shardInfos.flatMap((s, i) => (s ? [i] : []));
  const [lockVault, refundVault] = await Promise.all([tokenAmount(connection, pdas.lockVault()), tokenAmount(connection, pdas.refundVault())]);

  const programDataAddress = pdas.programData();
  const pd = await connection.getAccountInfo(programDataAddress, "confirmed");
  const programData = pd
    ? {
        address: programDataAddress,
        lamports: pd.lamports,
        authority: pd.data[12] === 1 ? new PublicKey(pd.data.subarray(13, 45)) : null,
      }
    : null;

  let table: WindDownPlan["table"] = null;
  if (o.lookupTable) {
    const [res, info] = await Promise.all([
      connection.getAddressLookupTable(o.lookupTable, { commitment: "confirmed" }),
      connection.getAccountInfo(o.lookupTable, "confirmed"),
    ]);
    if (res.value && info) {
      table = {
        lamports: info.lamports,
        authority: res.value.state.authority ?? null,
        deactivating: res.value.state.deactivationSlot !== BigInt("18446744073709551615"),
      };
    }
  }

  const rent = async (addresses: PublicKey[]) =>
    (await connection.getMultipleAccountsInfo(addresses, "confirmed")).reduce((s, a) => s + (a?.lamports ?? 0), 0);
  const configLamports = config ? await rent([pdas.config()]) : 0;
  const shardLamports = shardInfos.reduce((s, a) => s + (a?.lamports ?? 0), 0);
  const closableEpochs = epochs.filter((e) => e.epoch.released || releasable.includes(e.epoch.epoch));
  const epochLamports = await rent(closableEpochs.map((e) => e.address));
  const lockWillBeEmpty = lockedLeft === 0n && (lockVault?.amount ?? 0n) - released(epochs, releasable) <= 0n;
  const toAdmin =
    configLamports +
    shardLamports +
    epochLamports +
    (refundVault && refundVault.amount === ads.reduce((s, a) => s + a.ad.refundDue, 0n) ? refundVault.lamports : 0) +
    (lockVault && lockWillBeEmpty ? lockVault.lamports : 0) +
    (table && table.authority?.equals(o.admin.publicKey) ? table.lamports : 0) +
    (programData && programData.authority?.equals(o.admin.publicKey) ? programData.lamports : 0);
  const toOwners = await rent(ads.map((a) => a.address));

  const blockers: string[] = [];
  if (config && !config.admin.equals(o.admin.publicKey)) blockers.push(`the admin is ${config.admin.toBase58()}, not this key`);
  if (programData && !programData.authority) blockers.push("the program is immutable (--final): it cannot be closed");
  else if (programData && !programData.authority!.equals(o.admin.publicKey)) {
    blockers.push(`the program's upgrade authority is ${programData.authority!.toBase58()}, not this key`);
  }
  if (lockedLeft > 0n && !o.strandLocked) {
    blockers.push(
      `${formatTokensExact(lockedLeft, decimals)} tokens are still locked until ${new Date(lastUnlock! * 1000).toISOString()}; wait until then, ` +
        `or wind down anyway and leave them in the lock for good (--strand-locked)`,
    );
  }

  return {
    config,
    ads,
    epochs,
    releasable,
    stillLocked: locked.map((e) => e.epoch.epoch),
    lockedLeft,
    lastUnlock,
    shards,
    lockVault,
    refundVault,
    programData,
    table,
    toAdmin,
    toOwners,
    refundsOwed: ads.reduce((s, a) => s + a.ad.refundDue, 0n),
    blockers,
    decimals,
  };
}

/** Tokens the releasable epochs will take out of the lock vault. */
function released(epochs: WindDownPlan["epochs"], releasable: number[]): bigint {
  return epochs.filter((e) => releasable.includes(e.epoch.epoch)).reduce((s, e) => s + e.epoch.amount, 0n);
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** The upgradeable loader's `Close` for a program: its ProgramData lamports go to `recipient`. */
export function closeProgramIx(programId: PublicKey, programData: PublicKey, authority: PublicKey, recipient: PublicKey) {
  return new TransactionInstruction({
    programId: UPGRADEABLE_LOADER,
    keys: [
      { pubkey: programData, isWritable: true, isSigner: false },
      { pubkey: recipient, isWritable: true, isSigner: false },
      { pubkey: authority, isWritable: false, isSigner: true },
      { pubkey: programId, isWritable: true, isSigner: false },
    ],
    data: Buffer.from([5, 0, 0, 0]),
  });
}

export async function executeWindDown(o: WindDownOptions, plan: WindDownPlan): Promise<void> {
  if (plan.blockers.length) throw new Error(`cannot wind down: ${plan.blockers.join("; ")}`);
  const { connection, admin, programId } = o;
  const log = o.log ?? (() => {});
  const priority = o.priority ?? 0;
  const tx = (label: string, ixs: TransactionInstruction[]) =>
    send(connection, admin, ixs, priority).then((sig) => log(`${label}: ${sig}`));

  const c = plan.config;
  if (c) {
    const ixs = new LotzInstructions({ programId, mint: c.tokenMint, tokenProgram: c.tokenProgram, treasury: c.treasury });

    if (!c.paused && !c.retired) await tx("pause", [ixs.setPaused(admin.publicKey, true)]);
    for (const batch of chunks(plan.releasable, 3)) {
      await tx(`release epochs ${batch.join(",")}`, batch.map((e) => ixs.releaseEpoch(admin.publicKey, e)));
    }
    if (!c.retired) await tx("retire", [ixs.retire(admin.publicKey)]);

    const owed = plan.ads.filter((a) => a.ad.refundDue > 0n);
    for (const batch of chunks(owed, 3)) {
      await tx(
        `refunds for ads ${batch.map((a) => a.ad.adId).join(",")}`,
        batch.map((a) => ixs.claimRefund(admin.publicKey, a.address, a.ad.owner)),
      );
    }
    for (const batch of chunks(plan.ads, 6)) {
      await tx(
        `close ads ${batch.map((a) => a.ad.adId).join(",")}`,
        batch.map((a) => ixs.closeAd(admin.publicKey, a.address, a.ad.owner)),
      );
    }
    const closable = plan.epochs.filter((e) => e.epoch.released || plan.releasable.includes(e.epoch.epoch)).map((e) => e.epoch.epoch);
    for (const batch of chunks(closable, 8)) {
      await tx(`close epochs ${batch.join(",")}`, batch.map((e) => ixs.retireEpoch(admin.publicKey, e)));
    }
    for (const batch of chunks(plan.shards, 15)) {
      await tx(`close shards ${batch[0]}..${batch[batch.length - 1]}`, [ixs.retireShards(admin.publicKey, batch)]);
    }
    await tx("close config and vaults", [ixs.retireConfig(admin.publicKey)]);
  }

  if (o.lookupTable && plan.table && plan.table.authority?.equals(admin.publicKey)) {
    if (!plan.table.deactivating) {
      await tx("deactivate lookup table", [
        AddressLookupTableProgram.deactivateLookupTable({ lookupTable: o.lookupTable, authority: admin.publicKey }),
      ]);
    }
    const state = await connection.getAddressLookupTable(o.lookupTable, { commitment: "confirmed" });
    const from = Number(state.value!.state.deactivationSlot);
    log(`waiting for the lookup table to cool down (~${ALT_COOLDOWN_SLOTS} slots, about 3.5 minutes)`);
    while ((await connection.getSlot("confirmed")) <= from + ALT_COOLDOWN_SLOTS) {
      await new Promise((r) => setTimeout(r, (o.pollSeconds ?? 10) * 1000));
    }
    await tx("close lookup table", [
      AddressLookupTableProgram.closeLookupTable({ lookupTable: o.lookupTable, authority: admin.publicKey, recipient: admin.publicKey }),
    ]);
  }

  if (plan.programData) {
    await tx("close program", [closeProgramIx(programId, plan.programData.address, admin.publicKey, admin.publicKey)]);
  }
}
