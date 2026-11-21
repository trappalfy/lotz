import "server-only";
import { attachDatabasePool } from "@vercel/functions";
import { createPool, type Pool } from "@lotz/db";
import { env } from "./env";

const g = globalThis as unknown as { __lotzPool?: Pool };

/**
 * One pool per server process (survives dev hot reloads). On Vercel every function instance has its own, so it
 * stays small, and `attachDatabasePool` lets idle connections close before an instance is suspended (a no-op
 * elsewhere). Point DATABASE_URL at the provider's pooled endpoint there.
 */
export function pool(): Pool {
  if (!g.__lotzPool) {
    const serverless = !!process.env.VERCEL;
    g.__lotzPool = createPool(env.databaseUrl(), serverless ? { max: 5, idleTimeoutMillis: 5_000 } : {});
    attachDatabasePool(g.__lotzPool);
  }
  return g.__lotzPool;
}
