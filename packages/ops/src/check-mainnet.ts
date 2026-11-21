/**
 * Checks every value in `.env.mainnet` against the real services, read-only, without printing secrets:
 * keys, Helius, the chain (balances, addresses), R2, Neon, Vercel, Railway, DNS, the token mint.
 * Sends no transaction. The only write is a tiny test file in R2, deleted right after.
 *
 *   pnpm --filter @lotz/ops check-mainnet [path/to/.env.mainnet]
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { resolve4 } from "node:dns/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";
import { Connection, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getExtensionTypes, getMint, ExtensionType } from "@solana/spl-token";
import { createPool } from "@lotz/db";
import { S3Storage } from "@lotz/storage";
import { keypair, repoRoot } from "./common";
import { derive, parseEnvFile, type Env } from "./mainnet-env";

const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const UPGRADEABLE_LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const SOL_NEEDED = 7.2;
const SECRET_KEYS = [
  "HELIUS_API_KEY",
  "RPC_URL",
  "RPC_WS_URL",
  "STORAGE_S3_SECRET_ACCESS_KEY",
  "STORAGE_S3_ACCESS_KEY_ID",
  "DATABASE_URL",
  "DATABASE_URL_UNPOOLED",
  "VERCEL_TOKEN",
  "RAILWAY_TOKEN",
  "SESSION_SECRET",
  "HELIUS_WEBHOOK_SECRET",
];

type Status = "ok" | "fail" | "todo" | "info";
const MARK: Record<Status, string> = { ok: "✓", fail: "✗", todo: "…", info: "·" };

const file = process.argv[2]
  ? resolve(process.env.INIT_CWD ?? process.cwd(), process.argv[2])
  : resolve(repoRoot(), ".env.mainnet");
const raw = parseEnvFile(file);
const e: Env = derive(raw);
const secrets = SECRET_KEYS.map((k) => e[k]).filter((v): v is string => !!v && v.length >= 6);

/** Error text with every secret value (and any api-key query) blanked out. */
function clean(msg: string): string {
  let out = msg.replace(/api-key=[^&\s"']+/g, "api-key=***");
  for (const s of secrets) out = out.split(s).join("***");
  return out.slice(0, 300);
}

let failures = 0;
async function check(name: string, fn: () => Promise<[Status, string]>): Promise<void> {
  let status: Status;
  let text: string;
  try {
    [status, text] = await fn();
  } catch (err) {
    status = "fail";
    text = clean(String((err as Error)?.message ?? err));
  }
  if (status === "fail") failures++;
  console.log(`${MARK[status]} ${name.padEnd(18)} ${text}`);
}

const need = (...keys: string[]) => keys.filter((k) => !e[k]);
const withTimeout = <T>(p: Promise<T>, ms: number, what: string) =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`${what}: no answer in ${ms / 1000} s`)), ms))]);

console.log(`Checking ${file}\n`);

await check("program key", async () => {
  const path = e.PROGRAM_KEYPAIR || "keys/lotz-program.json";
  const full = resolve(repoRoot(), path);
  if (!existsSync(full)) return ["fail", `${path} is missing`];
  const pub = keypair(full).publicKey.toBase58();
  return pub === e.PROGRAM_ID ? ["ok", `${path} is ${pub}`] : ["fail", `${path} is ${pub}, PROGRAM_ID is ${e.PROGRAM_ID}`];
});

await check("admin key", async () => {
  const path = e.ADMIN_KEYPAIR || "keys/admin.json";
  const full = resolve(repoRoot(), path);
  if (!existsSync(full)) return ["todo", `${path} not imported yet: pnpm --filter @lotz/ops import-key ${path} ${e.ADMIN_ADDRESS ?? ""}`];
  const pub = keypair(full).publicKey.toBase58();
  return pub === e.ADMIN_ADDRESS ? ["ok", `${path} is ${pub}`] : ["fail", `${path} is ${pub}, expected ${e.ADMIN_ADDRESS}`];
});

let connection: Connection | null = null;
await check("Helius RPC", async () => {
  if (!e.RPC_URL) return ["todo", "HELIUS_API_KEY is empty"];
  const c = new Connection(e.RPC_URL, "confirmed");
  const genesis = await withTimeout(c.getGenesisHash(), 10_000, "RPC");
  if (genesis !== MAINNET_GENESIS) return ["fail", `this RPC is not mainnet (genesis ${genesis})`];
  connection = c;
  return ["ok", `mainnet, slot ${await c.getSlot()}`];
});

await check("Helius websocket", async () => {
  if (!e.RPC_WS_URL) return ["todo", "HELIUS_API_KEY is empty"];
  const ws = new WebSocket(e.RPC_WS_URL);
  await withTimeout(
    new Promise<void>((ok, fail) => {
      ws.onopen = () => ok();
      ws.onerror = () => fail(new Error("websocket refused the connection"));
    }),
    10_000,
    "websocket",
  );
  ws.close();
  return ["ok", "connects"];
});

await check("admin SOL", async () => {
  if (!connection) return ["todo", "needs the RPC"];
  const lamports = await connection.getBalance(new PublicKey(e.ADMIN_ADDRESS!));
  const sol = lamports / LAMPORTS_PER_SOL;
  return sol >= SOL_NEEDED
    ? ["ok", `${sol.toFixed(3)} SOL on ${e.ADMIN_ADDRESS}`]
    : ["todo", `${sol.toFixed(3)} SOL on ${e.ADMIN_ADDRESS}; about ${SOL_NEEDED} SOL needed to deploy and launch`];
});

await check("treasury", async () => {
  if (!connection) return ["todo", "needs the RPC"];
  const info = await connection.getAccountInfo(new PublicKey(e.TREASURY!));
  if (!info) return ["ok", `${e.TREASURY} (no account yet; fine)`];
  return info.owner.equals(SystemProgram.programId)
    ? ["ok", `${e.TREASURY} is a wallet`]
    : ["fail", `${e.TREASURY} is owned by ${info.owner.toBase58()}; initialize will refuse it`];
});

await check("program address", async () => {
  if (!connection) return ["todo", "needs the RPC"];
  const id = new PublicKey(e.PROGRAM_ID!);
  const info = await connection.getAccountInfo(id);
  if (!info) return ["ok", `${e.PROGRAM_ID} is free: ready to deploy`];
  if (!info.owner.equals(UPGRADEABLE_LOADER)) return ["fail", `${e.PROGRAM_ID} exists and is not an upgradeable program`];
  const [programData] = PublicKey.findProgramAddressSync([id.toBuffer()], UPGRADEABLE_LOADER);
  const pd = await connection.getAccountInfo(programData);
  const authority = pd && pd.data[12] === 1 ? new PublicKey(pd.data.subarray(13, 45)).toBase58() : null;
  return ["info", `deployed; upgrade authority ${authority ?? "none (immutable)"}`];
});

await check("token mint", async () => {
  if (!e.TOKEN_MINT) return ["todo", "TOKEN_MINT comes last"];
  if (!connection) return ["todo", "needs the RPC"];
  const mint = new PublicKey(e.TOKEN_MINT);
  const info = await connection.getAccountInfo(mint);
  if (!info) return ["fail", "mint account not found"];
  const program = info.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
  const m = await getMint(connection, mint, "confirmed", program);
  const ext = m.tlvData.length ? getExtensionTypes(m.tlvData).map((x) => ExtensionType[x]) : [];
  const desc = `${program.equals(TOKEN_2022_PROGRAM_ID) ? "Token-2022" : "SPL Token"}, ${m.decimals} decimals, extensions: ${ext.join(", ") || "none"}`;
  if (m.freezeAuthority) return ["fail", `${desc}; has a freeze authority, initialize will refuse it`];
  return ["ok", `${desc}; no freeze authority (the launch dry run checks extensions in detail)`];
});

await check("R2 storage", async () => {
  const missing = need("STORAGE_S3_ENDPOINT", "STORAGE_S3_BUCKET", "STORAGE_S3_ACCESS_KEY_ID", "STORAGE_S3_SECRET_ACCESS_KEY", "STORAGE_PUBLIC_URL");
  if (missing.length) return ["todo", `fill ${missing.join(", ")}`];
  const s3 = new S3Storage(e.STORAGE_S3_BUCKET!, e.STORAGE_PUBLIC_URL!, {
    endpoint: e.STORAGE_S3_ENDPOINT,
    region: e.STORAGE_S3_REGION,
    accessKeyId: e.STORAGE_S3_ACCESS_KEY_ID!,
    secretAccessKey: e.STORAGE_S3_SECRET_ACCESS_KEY!,
  });
  const key = `healthcheck/${randomBytes(8).toString("hex")}.txt`;
  const body = new TextEncoder().encode("lotz");
  const url = await s3.put(key, body, "text/plain", "no-store");
  try {
    const back = await s3.get(key);
    if (!back || new TextDecoder().decode(back) !== "lotz") return ["fail", "wrote a test file but could not read it back"];
    const res = await withTimeout(fetch(url), 10_000, "CDN").catch((err: Error) => err);
    if (res instanceof Error || !res.ok) {
      return ["todo", `bucket works; public URL ${e.STORAGE_PUBLIC_URL} does not serve it yet (custom domain not connected?)`];
    }
    return ["ok", `bucket ${e.STORAGE_S3_BUCKET} read/write, served at ${e.STORAGE_PUBLIC_URL}`];
  } finally {
    await s3.delete(key).catch(() => {});
  }
});

for (const [name, key, direct] of [
  ["Neon pooled", "DATABASE_URL", false],
  ["Neon direct", "DATABASE_URL_UNPOOLED", true],
] as const) {
  await check(name, async () => {
    if (!e[key]) return ["todo", `${key} is empty`];
    const pool = createPool(e[key], { max: 1 });
    try {
      const client = await withTimeout(pool.connect(), 15_000, "database");
      try {
        const v = (await client.query<{ v: string }>("show server_version")).rows[0]!.v;
        if (direct) await client.query("listen lotz_check; unlisten lotz_check");
        return ["ok", `Postgres ${v}${direct ? ", LISTEN works (for the indexer)" : " (for the site)"}`];
      } finally {
        client.release();
      }
    } finally {
      await pool.end();
    }
  });
}

await check("Vercel", async () => {
  if (!e.VERCEL_TOKEN) return ["todo", "VERCEL_TOKEN is empty"];
  const q = e.VERCEL_TEAM ? `?slug=${encodeURIComponent(e.VERCEL_TEAM)}` : "";
  const headers = { authorization: `Bearer ${e.VERCEL_TOKEN}` };
  const user = await fetch(`https://api.vercel.com/v2/user`, { headers });
  if (!user.ok) return ["fail", `token refused (${user.status})`];
  if (!e.VERCEL_PROJECT) return ["todo", "token works; VERCEL_PROJECT is empty"];
  const res = await fetch(`https://api.vercel.com/v9/projects/${encodeURIComponent(e.VERCEL_PROJECT)}${q}`, { headers });
  if (res.status === 404) return ["todo", `token works; project "${e.VERCEL_PROJECT}" not found${e.VERCEL_TEAM ? "" : " (under a team? set VERCEL_TEAM)"}`];
  if (!res.ok) return ["fail", `project lookup failed (${res.status})`];
  const p = (await res.json()) as { rootDirectory?: string | null; framework?: string | null; link?: { org?: string; repo?: string } };
  const repo = p.link?.repo ? `${p.link.org}/${p.link.repo}` : "no repository";
  const problems = [p.rootDirectory !== "apps/web" ? `Root Directory is "${p.rootDirectory ?? ""}", should be apps/web` : null].filter(Boolean);
  return problems.length
    ? ["fail", `project ${e.VERCEL_PROJECT} (${repo}): ${problems.join("; ")}`]
    : ["ok", `project ${e.VERCEL_PROJECT}, ${p.framework ?? "?"}, root apps/web, ${repo}`];
});

await check("Railway", async () => {
  const env = { ...process.env, ...(e.RAILWAY_TOKEN ? { RAILWAY_TOKEN: e.RAILWAY_TOKEN } : {}) };
  const run = promisify(execFile);
  try {
    const { stdout } = await run("railway", ["whoami"], { env, timeout: 15_000 });
    return ["ok", `CLI ready (${stdout.trim().split("\n")[0]?.replace(/\S+@\S+/, "your account")})`];
  } catch {
    return ["todo", "Railway CLI is not logged in (railway login) and RAILWAY_TOKEN is empty"];
  }
});

await check("DNS", async () => {
  const domain = e.SITE_DOMAIN;
  if (!domain) return ["todo", "SITE_DOMAIN is empty"];
  const names = [domain, `cdn.${domain}`, `live.${domain}`];
  const found = await Promise.all(names.map((n) => resolve4(n).then(() => n, () => null)));
  const missing = names.filter((_, i) => !found[i]);
  return missing.length ? ["todo", `no address yet for ${missing.join(", ")}`] : ["ok", names.join(", ")];
});

await check("other settings", async () => {
  const missing = need("NEXT_PUBLIC_X_URL", "SITE_DOMAIN");
  const generated = need("SESSION_SECRET", "HELIUS_WEBHOOK_SECRET");
  const parts = [];
  if (missing.length) parts.push(`fill ${missing.join(", ")}`);
  if (generated.length) parts.push(`${generated.join(", ")} will be generated`);
  return parts.length ? ["todo", parts.join("; ")] : ["ok", "all set"];
});

console.log(`\n${failures ? `${failures} problem(s) above.` : "No problems. Items marked … are still to do."}`);
process.exit(failures ? 1 : 0);
