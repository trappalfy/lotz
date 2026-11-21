import type { Connection, PublicKey } from "@solana/web3.js";
import { markProcessed, processedAmong, type Pool } from "@lotz/db";
import type { Indexer } from "./indexer";

/**
 * Every program signature not processed yet, oldest first. Pages back from the newest until a page contains
 * signatures we already know (so a gap the websocket left just before a known one is still filled).
 * Returns how many new signatures were handled.
 */
export async function pollOnce(connection: Connection, programId: PublicKey, pool: Pool, indexer: Indexer): Promise<number> {
  const fresh: { signature: string; err: unknown }[] = [];
  let before: string | undefined;
  for (;;) {
    const page = await connection.getSignaturesForAddress(programId, { before, limit: 500 }, "confirmed");
    const known = await processedAmong(pool, page.map((s) => s.signature));
    fresh.push(...page.filter((s) => !known.has(s.signature)));
    if (known.size > 0 || page.length < 500) break;
    before = page[page.length - 1]!.signature;
  }
  for (const s of fresh.reverse()) {
    if (s.err) await markProcessed(pool, [s.signature]);
    else await indexer.handleSignature(s.signature);
  }
  return fresh.length;
}
