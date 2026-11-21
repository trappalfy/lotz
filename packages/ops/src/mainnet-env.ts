/**
 * The owner's mainnet settings file (`.env.mainnet`, gitignored) and what each service gets from it. The owner fills
 * a few values (keys, domain); everything else is derived here so the two services cannot drift apart.
 */
import { existsSync, readFileSync } from "node:fs";

export type Env = Record<string, string>;

export function parseEnvFile(path: string): Env {
  if (!existsSync(path)) throw new Error(`${path} not found`);
  const out: Env = {};
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2]!.replace(/\s+#.*$/, "").trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]!] = v;
  }
  return out;
}

/** Values derived from the few the owner fills in. */
export function derive(e: Env): Env {
  const d: Env = { ...e };
  const domain = e.SITE_DOMAIN?.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (e.HELIUS_API_KEY) {
    d.RPC_URL ||= `https://mainnet.helius-rpc.com/?api-key=${e.HELIUS_API_KEY}`;
    d.RPC_WS_URL ||= `wss://mainnet.helius-rpc.com/?api-key=${e.HELIUS_API_KEY}`;
  }
  if (e.R2_ACCOUNT_ID) d.STORAGE_S3_ENDPOINT ||= `https://${e.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  if (domain) {
    d.NEXT_PUBLIC_SITE_URL ||= `https://${domain}`;
    d.STORAGE_PUBLIC_URL ||= `https://cdn.${domain}`;
    d.STREAM_URL ||= `https://live.${domain}/stream`;
    d.INDEXER_URL ||= `https://live.${domain}`;
  }
  d.STORAGE_DRIVER ||= "s3";
  d.STORAGE_S3_REGION ||= "auto";
  d.NEXT_PUBLIC_CLUSTER ||= "mainnet-beta";
  d.NSFW_FILTER ||= "on";
  return d;
}

const SHARED = [
  "RPC_URL",
  "PROGRAM_ID",
  "STORAGE_DRIVER",
  "STORAGE_PUBLIC_URL",
  "STORAGE_S3_ENDPOINT",
  "STORAGE_S3_REGION",
  "STORAGE_S3_BUCKET",
  "STORAGE_S3_ACCESS_KEY_ID",
  "STORAGE_S3_SECRET_ACCESS_KEY",
  "NSFW_FILTER",
];

/** What the site on Vercel gets. DATABASE_URL there is the pooled endpoint (the Neon integration sets it). */
export function siteEnv(d: Env): Env {
  return pick(d, [
    ...SHARED,
    "LOOKUP_TABLE",
    "NEXT_PUBLIC_CLUSTER",
    "PRIORITY_FEE_MICROLAMPORTS",
    "ADMIN_WALLET",
    "NEXT_PUBLIC_SITE_URL",
    "SESSION_SECRET",
    "NEXT_PUBLIC_X_URL",
    "NEXT_PUBLIC_SOURCE_URL",
    "STREAM_URL",
  ], { ENABLE_EXPERIMENTAL_COREPACK: "1" });
}

/** What the indexer on Railway gets. It needs the direct (unpooled) database connection for LISTEN. */
export function indexerEnv(d: Env): Env {
  return pick(d, [...SHARED, "RPC_WS_URL", "HELIUS_WEBHOOK_SECRET", "POLL_INTERVAL_MS"], {
    DATABASE_URL: d.DATABASE_URL_UNPOOLED ?? "",
    INDEXER_HOST: "0.0.0.0",
    RAILWAY_DOCKERFILE_PATH: "apps/indexer/Dockerfile",
  });
}

function pick(d: Env, keys: string[], extra: Env): Env {
  const out: Env = {};
  for (const k of keys) if (d[k]) out[k] = d[k]!;
  for (const [k, v] of Object.entries(extra)) if (v) out[k] = v;
  return out;
}

/** Shows that a secret is set without showing it. */
export function mask(v: string | undefined): string {
  if (!v) return "(empty)";
  return `set (${v.length} characters)`;
}
