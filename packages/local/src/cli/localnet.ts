/**
 * `pnpm localnet [--reset] [--seed]`: a complete local Lotz.
 * - starts solana-test-validator on 18899/18900 with the program deployed (upgradeable, dev wallet = authority),
 *   unless one is already answering there;
 * - creates a test token, initializes Lotz, the 100 shards and the lookup table (first run only);
 * - writes the local values into the repository's .env;
 * - `--seed` buys demo ads (abstract images, neutral titles) including a lot taken over several times;
 * - `--reset` wipes the ledger, the local database schema and local storage first.
 * Local only: refuses any non-local RPC or database.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import pg from "pg";
import { IDL_PROGRAM_ID, fetchConfig, LotzPdas } from "@lotz/sdk";
import { LocalLotz, TOKEN, assertLocal, loadKeypair, startValidator } from "../index";
import { randomSecret, readEnv, updateEnv } from "../env-file";
import { seedDemo } from "../seed";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const DATA = join(ROOT, ".data");
const STATE = join(DATA, "localnet.json");
const RPC_PORT = 18899;
const RPC = `http://127.0.0.1:${RPC_PORT}`;
const WS = `ws://127.0.0.1:${RPC_PORT + 1}`;

const args = new Set(process.argv.slice(2));
const reset = args.has("--reset");
const seed = args.has("--seed");

interface LocalState {
  programId: string;
  mint: string;
  treasury: string;
  lookupTable: string;
}

async function rpcUp(): Promise<boolean> {
  try {
    await new Connection(RPC).getSlot();
    return true;
  } catch {
    return false;
  }
}

async function resetDatabase(url: string): Promise<void> {
  const host = new URL(url).hostname;
  if (!["127.0.0.1", "localhost"].includes(host)) throw new Error(`refusing to reset a non-local database: ${host}`);
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  await c.query("drop schema public cascade; create schema public;");
  await c.end();
}

async function main(): Promise<void> {
  assertLocal(RPC);
  mkdirSync(DATA, { recursive: true });
  const envPath = join(ROOT, ".env");
  const env = readEnv(envPath);
  const admin = loadKeypair(join(ROOT, "keys/dev-wallet.json"));

  if (reset) {
    if (await rpcUp()) throw new Error(`a validator is running on ${RPC}; stop it before --reset`);
    rmSync(join(DATA, "ledger"), { recursive: true, force: true });
    rmSync(join(DATA, "storage"), { recursive: true, force: true });
    rmSync(STATE, { force: true });
    await resetDatabase(env.get("DATABASE_URL") || "postgres://127.0.0.1:5433/lotz");
    console.log("reset: ledger, storage and database wiped");
  }

  let stop: (() => Promise<void>) | null = null;
  if (await rpcUp()) {
    console.log(`using the validator already running on ${RPC}`);
  } else {
    const so = join(ROOT, "target/deploy/lotz.so");
    if (!existsSync(so)) throw new Error("target/deploy/lotz.so missing: run `anchor build` first");
    console.log("starting solana-test-validator ...");
    const v = await startValidator({
      ledger: join(DATA, "ledger"),
      programSo: so,
      programId: IDL_PROGRAM_ID,
      upgradeAuthority: admin.publicKey,
      rpcPort: RPC_PORT,
      faucetPort: 19900,
      gossipPort: 18001,
      dynamicPortRange: "18100-18200",
    });
    stop = v.stop;
    console.log(`validator up: ${v.url}`);
  }

  const connection = new Connection(RPC, { commitment: "confirmed", wsEndpoint: WS });
  if ((await connection.getBalance(admin.publicKey)) < 50e9) {
    const sig = await connection.requestAirdrop(admin.publicKey, 500e9);
    await connection.confirmTransaction({ signature: sig, ...(await connection.getLatestBlockhash()) }, "confirmed");
  }

  let state: LocalState | null = existsSync(STATE) ? (JSON.parse(readFileSync(STATE, "utf8")) as LocalState) : null;
  const pdas = new LotzPdas(IDL_PROGRAM_ID);
  const config = await fetchConfig(connection, pdas);
  if (!config || !state) {
    if (config) throw new Error("Lotz is initialized on this ledger but .data/localnet.json is missing; run with --reset");
    console.log("creating the test token and initializing Lotz ...");
    const mint = await LocalLotz.createMint(connection, admin);
    const treasury = Keypair.generate().publicKey;
    const lotz = new LocalLotz(connection, admin, { programId: IDL_PROGRAM_ID, mint, tokenProgram: TOKEN_PROGRAM_ID, treasury });
    // the same price as mainnet (BASE_PRICE_TOKENS=7000 in packages/ops/src/launch.ts)
    await lotz.initialize(admin, { basePrice: 7_000n * TOKEN, tierSize: 1000, tierMultBps: 12_500, maxRect: 10, paused: false });
    await lotz.createShards(admin);
    const lookupTable = await lotz.createLookupTable(admin);
    state = { programId: IDL_PROGRAM_ID.toBase58(), mint: mint.toBase58(), treasury: treasury.toBase58(), lookupTable: lookupTable.toBase58() };
    writeFileSync(STATE, JSON.stringify(state, null, 2));
  }

  updateEnv(envPath, join(ROOT, ".env.example"), {
    RPC_URL: RPC,
    RPC_WS_URL: WS,
    PROGRAM_ID: state.programId,
    TOKEN_MINT: state.mint,
    TREASURY: state.treasury,
    LOOKUP_TABLE: state.lookupTable,
    ADMIN_WALLET: env.get("ADMIN_WALLET") || admin.publicKey.toBase58(),
    NEXT_PUBLIC_CLUSTER: "localnet",
    SESSION_SECRET: env.get("SESSION_SECRET") || randomSecret(),
    DATABASE_URL: env.get("DATABASE_URL") || "postgres://127.0.0.1:5433/lotz",
    // live updates come from the indexer, as in production
    STREAM_URL: env.get("STREAM_URL") || `http://127.0.0.1:${env.get("INDEXER_PORT") || 4100}/stream`,
  });
  console.log("wrote .env");

  if (seed) {
    const lotz = new LocalLotz(connection, admin, {
      programId: new PublicKey(state.programId),
      mint: new PublicKey(state.mint),
      tokenProgram: TOKEN_PROGRAM_ID,
      treasury: new PublicKey(state.treasury),
    });
    await lotz.loadLookupTable(new PublicKey(state.lookupTable));
    const after = readEnv(envPath);
    await seedDemo(lotz, {
      storageDir: resolve(ROOT, "apps/indexer", after.get("STORAGE_LOCAL_DIR") || "../../.data/storage"),
      publicBase: after.get("STORAGE_PUBLIC_URL") || "http://localhost:3000/media",
      walletsFile: join(DATA, "seed-wallets.json"),
    });
  }

  console.log(`\nLotz localnet ready.\n  RPC        ${RPC}\n  program    ${state.programId}\n  token      ${state.mint}\n  lookup     ${state.lookupTable}\n`);
  if (stop) {
    console.log("validator running; Ctrl+C to stop");
    const shutdown = async () => {
      await stop!();
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    await new Promise(() => {});
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
