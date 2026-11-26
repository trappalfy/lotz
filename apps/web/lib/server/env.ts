import "server-only";

/** Server-side settings (never sent to the browser except where a route says so). */
export const env = {
  databaseUrl: () => required("DATABASE_URL"),
  rpcUrl: () => required("RPC_URL"),
  /** Where /api/rpc retries when RPC_URL is rate limited or down: the public endpoint on mainnet ("none": nowhere). */
  rpcFallbackUrl: () => {
    const v = process.env.RPC_FALLBACK_URL?.trim();
    if (v === "none") return null;
    if (v) return v;
    return (process.env.NEXT_PUBLIC_CLUSTER || "localnet") === "mainnet-beta" ? "https://api.mainnet-beta.solana.com" : null;
  },
  programId: () => required("PROGRAM_ID"),
  lookupTable: () => process.env.LOOKUP_TABLE || null,
  /** Wallets allowed into /admin (comma-separated). */
  adminWallets: () =>
    (process.env.ADMIN_WALLET ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  sessionSecret: () => {
    const s = process.env.SESSION_SECRET ?? "";
    if (s.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters");
    return s;
  },
  cluster: () => (process.env.NEXT_PUBLIC_CLUSTER || "localnet") as "localnet" | "devnet" | "mainnet-beta",
  priorityMicroLamports: () => Number(process.env.PRIORITY_FEE_MICROLAMPORTS ?? "0"),
  siteUrl: () => process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000",
  xUrl: () => process.env.NEXT_PUBLIC_X_URL || null,
  sourceUrl: () => process.env.NEXT_PUBLIC_SOURCE_URL || null,
  storageDriver: () => process.env.STORAGE_DRIVER ?? "local",
  /** The indexer's public SSE endpoint, e.g. https://live.lotz.fun/stream (unset: /api/stream on this site). */
  streamUrl: () => process.env.STREAM_URL || null,
};

function required(k: string): string {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is not set`);
  return v;
}
