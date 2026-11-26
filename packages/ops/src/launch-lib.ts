/**
 * The launch, built so that buying opens seconds after the token's mint appears on chain:
 * - the lookup table is made the day before: its addresses follow from the program and the mint address alone;
 * - initialize and the 100 shards go out in as few transactions as fit (two), buying resumes in the last one;
 * - every transaction is simulated first (a refused mint stops the launch before anything is spent), then sent to
 *   every RPC given and re-sent until it is confirmed.
 */
import {
  AddressLookupTableAccount,
  AddressLookupTableProgram,
  type AccountInfo,
  Connection,
  Keypair,
  PublicKey,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getExtensionTypes,
  getMintCloseAuthority,
  unpackMint,
} from "@solana/spl-token";
import bs58 from "bs58";
import { LotzInstructions, LotzPdas, MAX_TX_BYTES, SHARD_COUNT, buildV0, computeBudgetIxs, decodeConfig, type InitParams } from "@lotz/sdk";

/** pump.fun mints: 1 billion tokens with 6 decimals, minted in the transaction that creates the mint. */
export const PUMP_DECIMALS = 6;
export const PUMP_SUPPLY = 1_000_000_000n * 10n ** 6n;
/** Account locks per transaction on mainnet. */
export const MAX_TX_ACCOUNTS = 64;
const MAX_CU = 1_400_000;

/** Token-2022 extensions the program accepts (programs/lotz/src/mint_check.rs). */
const ALLOWED_EXTENSIONS = new Set<ExtensionType>([
  ExtensionType.MetadataPointer,
  ExtensionType.TokenMetadata,
  ExtensionType.GroupPointer,
  ExtensionType.TokenGroup,
  ExtensionType.GroupMemberPointer,
  ExtensionType.TokenGroupMember,
  ExtensionType.MintCloseAuthority,
  ExtensionType.InterestBearingConfig,
  ExtensionType.ScaledUiAmountConfig,
]);

export type Log = (msg: string) => void;

// ---------------------------------------------------------------- lookup table

/**
 * The addresses of the launch and of every purchase. The token program is not known before the mint exists
 * (pump.fun creates mints with either), so both are in.
 */
export function launchTableAddresses(programId: PublicKey, mint: PublicKey, treasury: PublicKey): PublicKey[] {
  const ixs = new LotzInstructions({ programId, mint, tokenProgram: TOKEN_PROGRAM_ID, treasury });
  const all = [...ixs.lookupTableAddresses(), TOKEN_2022_PROGRAM_ID, ixs.pdas.programData()];
  const seen = new Set<string>();
  return all.filter((a) => !seen.has(a.toBase58()) && !!seen.add(a.toBase58()));
}

/**
 * Waits until a lookup table holds `count` addresses and validators will take transactions that use it: its last
 * extension must be finalized. Simulation and RPC checks accept it as soon as it is confirmed, but the block
 * producer resolves tables against its rooted state, so until then such transactions are held back (measured:
 * ~30 slots, 13-20 s, on a test validator). Make the table well before it is needed.
 */
export async function loadTable(connection: Connection, address: PublicKey, count = 1, timeoutMs = 60_000): Promise<AddressLookupTableAccount> {
  const t0 = Date.now();
  for (;;) {
    const res = await connection.getAddressLookupTable(address, { commitment: "finalized" });
    const slot = await connection.getSlot("finalized");
    if (res.value && res.value.state.addresses.length >= count && slot > Number(res.value.state.lastExtendedSlot)) return res.value;
    if (Date.now() - t0 > timeoutMs) {
      const state = res.value ? `${res.value.state.addresses.length}/${count} addresses, last extended in slot ${res.value.state.lastExtendedSlot}, now ${slot}` : "not found";
      throw new Error(`lookup table ${address.toBase58()} is not ready: ${state}`);
    }
    await new Promise((r) => setTimeout(r, 400));
  }
}

/** Addresses the launch needs that the table lacks (empty: the table is good). */
export function missingFromTable(table: AddressLookupTableAccount, needed: PublicKey[]): PublicKey[] {
  const have = new Set(table.state.addresses.map((a) => a.toBase58()));
  return needed.filter((a) => !have.has(a.toBase58()));
}

/** Creates the lookup table and fills it; returns it once usable. */
export async function createLaunchTable(o: {
  connection: Connection;
  admin: Keypair;
  addresses: PublicKey[];
  send: (ixs: TransactionInstruction[]) => Promise<string>;
  log?: Log;
}): Promise<AddressLookupTableAccount> {
  const slot = await o.connection.getSlot("finalized");
  const [create, address] = AddressLookupTableProgram.createLookupTable({ authority: o.admin.publicKey, payer: o.admin.publicKey, recentSlot: slot });
  const created = await o.send([create]);
  o.log?.(`lookup table ${address.toBase58()}: ${created}`);
  for (let i = 0; i < o.addresses.length; i += 25) {
    const extend = AddressLookupTableProgram.extendLookupTable({
      lookupTable: address,
      authority: o.admin.publicKey,
      payer: o.admin.publicKey,
      addresses: o.addresses.slice(i, i + 25),
    });
    const sig = await o.send([extend]);
    o.log?.(`  addresses ${i}-${Math.min(i + 25, o.addresses.length) - 1}: ${sig}`);
  }
  return loadTable(o.connection, address, o.addresses.length);
}

// ---------------------------------------------------------------- the mint

export interface MintFacts {
  tokenProgram: PublicKey;
  decimals: number;
  supply: bigint;
  mintAuthority: PublicKey | null;
  freezeAuthority: PublicKey | null;
  extensions: string[];
  /** Reasons not to launch on this mint: the program would refuse it, or it is not the expected token. */
  problems: string[];
}

export function inspectMint(
  mint: PublicKey,
  info: AccountInfo<Buffer>,
  expect: { decimals?: number; supply?: bigint } = { decimals: PUMP_DECIMALS, supply: PUMP_SUPPLY },
): MintFacts {
  const problems: string[] = [];
  const tokenProgram = info.owner;
  if (!tokenProgram.equals(TOKEN_PROGRAM_ID) && !tokenProgram.equals(TOKEN_2022_PROGRAM_ID)) {
    return { tokenProgram, decimals: 0, supply: 0n, mintAuthority: null, freezeAuthority: null, extensions: [], problems: [`not a token mint (owner ${tokenProgram.toBase58()})`] };
  }
  const m = unpackMint(mint, info, tokenProgram);
  const types = m.tlvData.length ? getExtensionTypes(m.tlvData) : [];
  if (m.freezeAuthority) problems.push(`it has a freeze authority (${m.freezeAuthority.toBase58()})`);
  const close = getMintCloseAuthority(m)?.closeAuthority;
  if (close && !close.equals(PublicKey.default)) problems.push(`it has a close authority (${close.toBase58()})`);
  for (const t of types) if (!ALLOWED_EXTENSIONS.has(t)) problems.push(`extension ${ExtensionType[t] ?? t} is not allowed`);
  if (expect.decimals !== undefined && m.decimals !== expect.decimals) problems.push(`${m.decimals} decimals, expected ${expect.decimals}`);
  if (expect.supply !== undefined && m.supply !== expect.supply) problems.push(`supply ${m.supply} base units, expected ${expect.supply}`);
  return {
    tokenProgram,
    decimals: m.decimals,
    supply: m.supply,
    mintAuthority: m.mintAuthority,
    freezeAuthority: m.freezeAuthority,
    extensions: types.map((t) => ExtensionType[t] ?? String(t)),
    problems,
  };
}

/**
 * Resolves with the mint account as soon as it exists (confirmed): a websocket subscription, and polling every
 * `pollMs` in case the socket misses it.
 */
export function waitForAccount(connection: Connection, address: PublicKey, o: { pollMs?: number; signal?: AbortSignal } = {}): Promise<AccountInfo<Buffer>> {
  return new Promise((resolve, reject) => {
    let done = false;
    let sub: number | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (info: AccountInfo<Buffer> | null, err?: unknown) => {
      if (done || (!info && !err)) return;
      done = true;
      clearTimeout(timer);
      if (sub !== undefined) void connection.removeAccountChangeListener(sub).catch(() => {});
      if (err) reject(err);
      else resolve(info!);
    };
    o.signal?.addEventListener("abort", () => finish(null, new Error("stopped")));
    try {
      sub = connection.onAccountChange(address, (info) => finish(info.data.length ? info : null), { commitment: "confirmed" });
    } catch {
      /* polling alone */
    }
    const poll = async () => {
      if (done) return;
      try {
        finish(await connection.getAccountInfo(address, "confirmed"));
      } catch {
        /* the next poll */
      }
      if (!done) timer = setTimeout(() => void poll(), o.pollMs ?? 1_000);
    };
    void poll();
  });
}

// ---------------------------------------------------------------- packing

/** Size and account count of a transaction with these instructions, compiled against the table. */
export function measure(payer: PublicKey, ixs: TransactionInstruction[], table: AddressLookupTableAccount): { bytes: number; accounts: number } {
  const tx = buildV0(payer, [...computeBudgetIxs(MAX_CU, 1), ...ixs], PublicKey.default.toBase58(), [table]);
  const lookups = tx.message.addressTableLookups.reduce((n, l) => n + l.writableIndexes.length + l.readonlyIndexes.length, 0);
  let bytes: number;
  try {
    bytes = tx.serialize().length;
  } catch {
    bytes = Infinity;
  }
  return { bytes, accounts: tx.message.staticAccountKeys.length + lookups };
}

/**
 * Instructions per transaction, counting the ones programs call (MAX_INSTRUCTION_TRACE_LENGTH): this, not the
 * size, is what limits shards per transaction, as each one also calls the System Program to create its account.
 */
export const MAX_TX_TRACE = 64;
/** Trace entries per instruction: itself and what it calls; initialize's is a margin over its use (see the launch test). */
export const TRACE = { computeBudget: 2, initialize: 16, shard: 2, setPaused: 1 } as const;

/**
 * The launch in rounds: the transactions of a round go out together; a round starts once the one before has
 * landed. Round 1 initializes (paused) with as many shards as fit, the middle round creates the remaining shards,
 * the last resumes buying (when `open`) with the last shards, so buying opens only once every shard exists.
 */
export function packLaunch(o: {
  ixs: LotzInstructions;
  admin: PublicKey;
  table: AddressLookupTableAccount;
  initialize?: InitParams;
  shards: number[];
  open: boolean;
}): TransactionInstruction[][][] {
  type Tx = { ixs: TransactionInstruction[]; trace: number };
  const newTx = (): Tx => ({ ixs: [], trace: TRACE.computeBudget });
  const add = (tx: Tx, ix: TransactionInstruction, trace: number): boolean => {
    if (tx.trace + trace > MAX_TX_TRACE) return false;
    const m = measure(o.admin, [...tx.ixs, ix], o.table);
    if (m.bytes > MAX_TX_BYTES || m.accounts > MAX_TX_ACCOUNTS) return false;
    tx.ixs.push(ix);
    tx.trace += trace;
    return true;
  };
  const shards = [...o.shards];
  const fill = (tx: Tx) => {
    while (shards.length && add(tx, o.ixs.initShard(o.admin, shards[0]!), TRACE.shard)) shards.shift();
  };

  const rounds: Tx[][] = [];
  if (o.initialize) {
    const first = newTx();
    add(first, o.ixs.initialize(o.admin, { ...o.initialize, paused: true }), TRACE.initialize);
    fill(first);
    rounds.push([first]);
  }
  const middle: Tx[] = [];
  while (shards.length) {
    const tx = newTx();
    fill(tx);
    if (!tx.ixs.length) throw new Error("a shard does not fit in a transaction");
    middle.push(tx);
  }
  if (o.open) {
    const resume = o.ixs.setPaused(o.admin, false);
    const last = middle.at(-1);
    if (last && add(last, resume, TRACE.setPaused)) middle.pop();
    const final = last?.ixs.at(-1) === resume ? last : newTx();
    if (final.ixs.at(-1) !== resume) add(final, resume, TRACE.setPaused);
    if (middle.length) rounds.push(middle);
    rounds.push([final]);
  } else if (middle.length) rounds.push(middle);
  return rounds.map((r) => r.map((tx) => tx.ixs));
}

// ---------------------------------------------------------------- sending

export interface Blockhash {
  blockhash: string;
  lastValidBlockHeight: number;
}

/** Keeps a recent blockhash at hand, so a transaction can be signed the moment it is needed. */
export function blockhashCache(connection: Connection, everyMs = 5_000): { get(): Promise<Blockhash>; stop(): void } {
  let latest: { at: number; value: Blockhash } | null = null;
  const refresh = async () => {
    const value = await connection.getLatestBlockhash("confirmed");
    latest = { at: Date.now(), value };
    return value;
  };
  const timer = setInterval(() => void refresh().catch(() => {}), everyMs);
  timer.unref?.();
  return {
    get: () => (latest && Date.now() - latest.at < 20_000 ? Promise.resolve(latest.value) : refresh()),
    stop: () => clearInterval(timer),
  };
}

export class SendError extends Error {
  constructor(
    message: string,
    readonly expired = false,
    readonly logs: string[] = [],
  ) {
    super(message);
  }
}

/**
 * Simulates, then sends to every connection and re-sends every `resendMs` until confirmed. The compute limit is
 * set from the simulation, so the priority fee is paid on what is used. Throws SendError (expired when the
 * blockhash ran out: check the chain and build again).
 */
export async function sendFast(o: {
  connections: Connection[];
  payer: Keypair;
  ixs: TransactionInstruction[];
  table: AddressLookupTableAccount;
  priority: number;
  blockhash: () => Promise<Blockhash>;
  resendMs?: number;
  log?: Log;
}): Promise<{ signature: string; units: number; ms: number }> {
  const [main, ...others] = o.connections;
  if (!main) throw new Error("no connection");
  const t0 = Date.now();
  const bh = await o.blockhash();

  const probe = buildV0(o.payer.publicKey, [...computeBudgetIxs(MAX_CU, o.priority), ...o.ixs], bh.blockhash, [o.table]);
  const sim = await main
    .simulateTransaction(probe, { sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" })
    .catch((e: unknown) => {
      throw new SendError(`simulation request failed: ${String((e as Error)?.message ?? e)}`);
    });
  if (sim.value.err) throw new SendError(`simulation failed: ${JSON.stringify(sim.value.err)}`, false, sim.value.logs ?? []);
  const units = sim.value.unitsConsumed ?? MAX_CU;
  const limit = Math.min(MAX_CU, Math.ceil(units * 1.1) + 5_000);

  const tx = buildV0(o.payer.publicKey, [...computeBudgetIxs(limit, o.priority), ...o.ixs], bh.blockhash, [o.table]);
  tx.sign([o.payer]);
  const raw = tx.serialize();
  const signature = bs58.encode(tx.signatures[0]!);
  const broadcast = () => {
    for (const c of [main, ...others]) c.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }).catch(() => {});
  };
  broadcast();
  let lastSend = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, 300));
    const st = (await main.getSignatureStatuses([signature]).catch(() => null))?.value[0];
    if (st?.err) throw new SendError(`${signature} failed: ${JSON.stringify(st.err)}`);
    if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) {
      return { signature, units, ms: Date.now() - t0 };
    }
    if (Date.now() - lastSend >= (o.resendMs ?? 2_000)) {
      const height = await main.getBlockHeight("confirmed").catch(() => 0);
      if (height > bh.lastValidBlockHeight) throw new SendError(`${signature} expired before it landed`, true);
      broadcast();
      lastSend = Date.now();
    }
  }
}

// ---------------------------------------------------------------- the launch

export interface LaunchState {
  initialized: boolean;
  paused: boolean;
  missingShards: number[];
}

export async function launchState(connection: Connection, pdas: LotzPdas): Promise<LaunchState> {
  // an RPC returns at most 100 accounts per call
  const [config, shards] = await Promise.all([
    connection.getAccountInfo(pdas.config(), "confirmed"),
    connection.getMultipleAccountsInfo(Array.from({ length: SHARD_COUNT }, (_, i) => pdas.shard(i)), "confirmed"),
  ]);
  return {
    initialized: !!config,
    paused: config ? decodeConfig(config.data).paused : true,
    missingShards: shards.flatMap((s, i) => (s ? [] : [i])),
  };
}

/**
 * Initializes Lotz on `mint`, creates the missing shards and (when `open`) resumes buying, re-reading the chain
 * after anything that did not land. Returns the signatures in order.
 */
export async function runLaunch(o: {
  connections: Connection[];
  admin: Keypair;
  programId: PublicKey;
  mint: PublicKey;
  tokenProgram: PublicKey;
  treasury: PublicKey;
  params: Omit<InitParams, "paused">;
  open: boolean;
  table: AddressLookupTableAccount;
  priority: number;
  blockhash: () => Promise<Blockhash>;
  attempts?: number;
  log?: Log;
}): Promise<string[]> {
  const ixs = new LotzInstructions({ programId: o.programId, mint: o.mint, tokenProgram: o.tokenProgram, treasury: o.treasury });
  const main = o.connections[0]!;
  const sigs: string[] = [];
  for (let attempt = 1; ; attempt++) {
    const st = await launchState(main, ixs.pdas);
    if (st.initialized && !st.missingShards.length && (!o.open || !st.paused)) return sigs;
    const rounds = packLaunch({
      ixs,
      admin: o.admin.publicKey,
      table: o.table,
      initialize: st.initialized ? undefined : { ...o.params, paused: true },
      shards: st.missingShards,
      open: o.open && st.paused,
    });
    try {
      for (const [i, round] of rounds.entries()) {
        // all of a round goes out together; a failure is thrown once the others have settled
        const results = await Promise.allSettled(
          round.map((g) => sendFast({ connections: o.connections, payer: o.admin, ixs: g, table: o.table, priority: o.priority, blockhash: o.blockhash, log: o.log })),
        );
        for (const [j, r] of results.entries()) {
          if (r.status === "rejected") continue;
          sigs.push(r.value.signature);
          o.log?.(`  round ${i + 1}/${rounds.length}, transaction ${j + 1}/${round.length}: ${round[j]!.length} instructions, ${r.value.units} CU, confirmed in ${r.value.ms} ms  ${r.value.signature}`);
        }
        const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
        if (failed) throw failed.reason;
      }
    } catch (e) {
      if (!(e instanceof SendError) || attempt >= (o.attempts ?? 4)) throw e;
      o.log?.(`  ${e.message}; reading the chain and trying again`);
      if (e.logs.length) o.log?.(e.logs.slice(-8).map((l) => `    ${l}`).join("\n"));
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}
