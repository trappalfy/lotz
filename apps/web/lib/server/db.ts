import "server-only";
import { createPool, type Pool } from "@lotz/db";
import { env } from "./env";

const g = globalThis as unknown as { __lotzPool?: Pool };

/** One pool per server process (survives dev hot reloads). */
export function pool(): Pool {
  g.__lotzPool ??= createPool(env.databaseUrl());
  return g.__lotzPool;
}
