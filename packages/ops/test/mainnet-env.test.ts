import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { derive, indexerEnv, mask, parseEnvFile, siteEnv } from "../src/mainnet-env";

const owner = {
  PROGRAM_ID: "LotzPiCxGrRhn8of391L6gPNTMnWXNwUdKyuiSoJaaa",
  SITE_DOMAIN: "lotz.fun",
  HELIUS_API_KEY: "hk",
  R2_ACCOUNT_ID: "acc",
  STORAGE_S3_BUCKET: "lotz-media",
  STORAGE_S3_ACCESS_KEY_ID: "id",
  STORAGE_S3_SECRET_ACCESS_KEY: "secret",
  DATABASE_URL: "postgres://pooled",
  DATABASE_URL_UNPOOLED: "postgres://direct",
  ADMIN_WALLET: "w",
  SESSION_SECRET: "s",
  HELIUS_WEBHOOK_SECRET: "h",
  VERCEL_TOKEN: "vt",
};

describe("mainnet env", () => {
  it("parses comments, quotes and trailing comments", () => {
    const dir = mkdtempSync(join(tmpdir(), "lotz-env-"));
    const p = join(dir, ".env.mainnet");
    writeFileSync(p, `# c\nA=1\nB = "two words"\nC=x # note\nD=\n`);
    expect(parseEnvFile(p)).toEqual({ A: "1", B: "two words", C: "x", D: "" });
  });

  it("derives URLs from the domain, the Helius key and the R2 account", () => {
    const d = derive(owner);
    expect(d.RPC_URL).toBe("https://mainnet.helius-rpc.com/?api-key=hk");
    expect(d.RPC_WS_URL).toBe("wss://mainnet.helius-rpc.com/?api-key=hk");
    expect(d.STORAGE_S3_ENDPOINT).toBe("https://acc.r2.cloudflarestorage.com");
    expect(d.STORAGE_PUBLIC_URL).toBe("https://cdn.lotz.fun");
    expect(d.STREAM_URL).toBe("https://live.lotz.fun/stream");
    expect(d.NEXT_PUBLIC_SITE_URL).toBe("https://lotz.fun");
  });

  it("gives each service only what it needs", () => {
    const d = derive(owner);
    const site = siteEnv(d);
    const indexer = indexerEnv(d);
    expect(site.STREAM_URL).toBe("https://live.lotz.fun/stream");
    expect(site.SESSION_SECRET).toBe("s");
    expect(site.ENABLE_EXPERIMENTAL_COREPACK).toBe("1");
    expect(site.DATABASE_URL).toBe(owner.DATABASE_URL); // pooled
    expect(site.DATABASE_URL_UNPOOLED).toBeUndefined();
    expect(site.RPC_WS_URL).toBeUndefined();
    expect(site.VERCEL_TOKEN).toBeUndefined();
    expect(indexer.DATABASE_URL).toBe("postgres://direct");
    expect(indexer.INDEXER_HOST).toBe("0.0.0.0");
    expect(indexer.HELIUS_WEBHOOK_SECRET).toBe("h");
    expect(indexer.SESSION_SECRET).toBeUndefined();
    expect(indexer.STORAGE_S3_SECRET_ACCESS_KEY).toBe("secret");
  });

  it("never shows a secret", () => {
    expect(mask("supersecretvalue")).not.toContain("secret");
    expect(mask("")).toBe("(empty)");
  });
});
