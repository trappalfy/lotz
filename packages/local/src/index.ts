/**
 * Local-validator helpers: a test mint, `initialize`, the 100 shards, the lookup table, funded wallets and buys.
 * Refuses to run against anything but a local RPC (brief §11: no mainnet transactions without the owner).
 */
import { readFileSync } from "node:fs";
import {
  AddressLookupTableAccount,
  AddressLookupTableProgram,
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SendTransactionError,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import {
  LotzInstructions,
  buildV0,
  buyComputeUnits,
  buyEpoch,
  chainTime,
  computeBudgetIxs,
  fetchConfig,
  fetchShards,
  findAds,
  parseEvents,
  quoteRect,
  randomNonce,
  emptyBoard,
  applyShard,
  ata,
  shardsForRect,
  type BuyArgs,
  type InitParams,
  type LotzDeployment,
  type LotzEvent,
  type Quote,
  type Rect,
} from "@lotz/sdk";

export function assertLocal(rpcUrl: string): void {
  const host = new URL(rpcUrl).hostname;
  if (!["127.0.0.1", "localhost", "0.0.0.0", "::1"].includes(host)) {
    throw new Error(`refusing to run local setup against ${rpcUrl}: local validator only`);
  }
}

export function loadKeypair(path: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8")) as number[]));
}

export const DECIMALS = 6;
export const TOKEN = 10n ** BigInt(DECIMALS);

export class LocalLotz {
  readonly ixs: LotzInstructions;
  lookupTable: AddressLookupTableAccount | null = null;

  constructor(
    readonly connection: Connection,
    readonly payer: Keypair,
    readonly d: LotzDeployment,
  ) {
    this.ixs = new LotzInstructions(d);
  }

  /** Creates a test mint (no freeze authority; mint authority = payer). */
  static async createMint(connection: Connection, payer: Keypair, token2022 = false): Promise<PublicKey> {
    return createMint(
      connection,
      payer,
      payer.publicKey,
      null,
      DECIMALS,
      Keypair.generate(),
      { commitment: "confirmed" },
      token2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID,
    );
  }

  async send(ixs: TransactionInstruction[], signers: Keypair[] = [], lookup = false): Promise<{ sig: string; logs: string[]; events: LotzEvent[] }> {
    const feePayer = signers[0] ?? this.payer;
    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash("confirmed");
    const tx = buildV0(feePayer.publicKey, ixs, blockhash, lookup && this.lookupTable ? [this.lookupTable] : []);
    const all = [feePayer, ...signers.slice(1)];
    tx.sign(all);
    try {
      const sig = await this.connection.sendTransaction(tx, { skipPreflight: false, preflightCommitment: "confirmed" });
      await this.connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
      const got = await this.connection.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
      const logs = got?.meta?.logMessages ?? [];
      if (got?.meta?.err) throw new Error(`transaction failed: ${JSON.stringify(got.meta.err)}\n${logs.join("\n")}`);
      return { sig, logs, events: parseEvents(logs, this.d.programId) };
    } catch (e) {
      if (e instanceof SendTransactionError) {
        const logs = await e.getLogs(this.connection).catch(() => []);
        throw new Error(`${e.message}\n${(logs ?? []).join("\n")}`);
      }
      throw e;
    }
  }

  async initialize(admin: Keypair, params: InitParams): Promise<void> {
    await this.send([this.ixs.initialize(admin.publicKey, params)], [admin]);
  }

  async createShards(admin: Keypair): Promise<void> {
    for (let b = 0; b < 10; b++) {
      const ixs = Array.from({ length: 10 }, (_, i) => this.ixs.initShard(admin.publicKey, b * 10 + i));
      await this.send(ixs, [admin]);
    }
  }

  /** Creates and fills the address lookup table with the deployment's fixed addresses. */
  async createLookupTable(authority: Keypair): Promise<PublicKey> {
    const slot = await this.connection.getSlot("finalized");
    const [create, address] = AddressLookupTableProgram.createLookupTable({
      authority: authority.publicKey,
      payer: authority.publicKey,
      recentSlot: slot,
    });
    await this.send([create], [authority]);
    const addresses = this.ixs.lookupTableAddresses();
    for (let i = 0; i < addresses.length; i += 25) {
      const extend = AddressLookupTableProgram.extendLookupTable({
        lookupTable: address,
        authority: authority.publicKey,
        payer: authority.publicKey,
        addresses: addresses.slice(i, i + 25),
      });
      await this.send([extend], [authority]);
    }
    await this.loadLookupTable(address);
    return address;
  }

  /** Loads the table; waits until it is usable (a table extended in slot N can be used from N+1). */
  async loadLookupTable(address: PublicKey): Promise<void> {
    for (let i = 0; i < 40; i++) {
      const res = await this.connection.getAddressLookupTable(address, { commitment: "confirmed" });
      const slot = await this.connection.getSlot("confirmed");
      if (res.value && res.value.state.addresses.length > 0 && slot > Number(res.value.state.lastExtendedSlot)) {
        this.lookupTable = res.value;
        return;
      }
      await new Promise((r) => setTimeout(r, 400));
    }
    throw new Error("lookup table did not activate");
  }

  async airdrop(to: PublicKey, sol = 10): Promise<void> {
    const sig = await this.connection.requestAirdrop(to, sol * LAMPORTS_PER_SOL);
    const bh = await this.connection.getLatestBlockhash("confirmed");
    await this.connection.confirmTransaction({ signature: sig, ...bh }, "confirmed");
  }

  /** A wallet with SOL and `tokens` base units in its ATA (minted by the payer). */
  async fundedWallet(tokens: bigint, sol = 10): Promise<Keypair> {
    const kp = Keypair.generate();
    await this.fund(kp.publicKey, tokens, sol);
    return kp;
  }

  async fund(owner: PublicKey, tokens: bigint, sol = 10): Promise<void> {
    if (sol > 0) await this.airdrop(owner, sol);
    const acc = await getOrCreateAssociatedTokenAccount(
      this.connection,
      this.payer,
      this.d.mint,
      owner,
      true,
      "confirmed",
      { commitment: "confirmed" },
      this.d.tokenProgram,
    );
    if (tokens > 0n) {
      await mintTo(this.connection, this.payer, this.d.mint, acc.address, this.payer, tokens, [], { commitment: "confirmed" }, this.d.tokenProgram);
    }
  }

  async tokenBalance(owner: PublicKey): Promise<bigint> {
    const res = await this.connection.getTokenAccountBalance(ata(owner, this.d.mint, this.d.tokenProgram), "confirmed").catch(() => null);
    return res ? BigInt(res.value.amount) : 0n;
  }

  async vaultBalance(which: "lock" | "refund"): Promise<bigint> {
    const address = which === "lock" ? this.ixs.pdas.lockVault() : this.ixs.pdas.refundVault();
    const res = await this.connection.getTokenAccountBalance(address, "confirmed");
    return BigInt(res.value.amount);
  }

  /** Quotes a rectangle from fresh shard state and finds the prior ads' addresses. */
  async quote(r: Rect): Promise<{ quote: Quote; priorAds: PublicKey[] }> {
    const config = await fetchConfig(this.connection, this.ixs.pdas);
    if (!config) throw new Error("not initialized");
    const shards = await fetchShards(this.connection, this.ixs.pdas, shardsForRect(r));
    const board = emptyBoard();
    for (const [index, lots] of shards) applyShard(board, { index, lots });
    const quote = quoteRect(board, r, config);
    const found = await findAds(this.connection, this.d.programId, quote.priorAdIds);
    const priorAds = quote.priorAdIds.map((id) => {
      const f = found.get(id);
      if (!f) throw new Error(`ad ${id} not found`);
      return f.address;
    });
    return { quote, priorAds };
  }

  async buy(
    buyer: Keypair,
    r: Rect,
    content: Partial<Pick<BuyArgs, "imageHash" | "imageUri" | "link" | "title" | "maxTotal">> = {},
  ): Promise<{ sig: string; events: LotzEvent[]; quote: Quote; args: BuyArgs; size: number }> {
    const config = await fetchConfig(this.connection, this.ixs.pdas);
    if (!config) throw new Error("not initialized");
    const { quote, priorAds } = await this.quote(r);
    const now = await chainTime(this.connection);
    const args: BuyArgs = {
      nonce: randomNonce(),
      ...r,
      epoch: buyEpoch(now, config),
      maxTotal: content.maxTotal ?? quote.total,
      imageHash: content.imageHash ?? new Uint8Array(32).fill(7),
      imageUri: content.imageUri ?? "https://cdn.lotz.local/i/test.webp",
      link: content.link ?? "https://example.com/your-coin",
      title: content.title ?? "your coin",
    };
    const ixs = [
      ...computeBudgetIxs(buyComputeUnits(r.w * r.h, priorAds.length), 0),
      this.ixs.buy(buyer.publicKey, args, priorAds),
    ];
    const { blockhash } = await this.connection.getLatestBlockhash("confirmed");
    const size = buildV0(buyer.publicKey, ixs, blockhash, this.lookupTable ? [this.lookupTable] : []).serialize().length;
    const res = await this.send(ixs, [buyer], true);
    return { ...res, quote, args, size };
  }
}

export { startValidator, type RunningValidator, type ValidatorOptions } from "./validator";
