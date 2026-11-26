import type { Connection, PublicKey } from "@solana/web3.js";
import { markProcessed, processedAmong, type Pool } from "@lotz/db";
import type { Indexer } from "./indexer";

/**
 * Every program signature not processed yet, oldest first. Pages back from the newest until a page contains
 * signatures we already know (so a gap the websocket left just before a known one is still filled).
 * Returns how many new signatures were handled; throws after trying them all if some could not be read.
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
  // one unreadable transaction must not hold up the rest: it stays unprocessed and is tried again next time
  const failed: string[] = [];
  for (const s of fresh.reverse()) {
    try {
      if (s.err) await markProcessed(pool, [s.signature]);
      else await indexer.handleSignature(s.signature);
    } catch (e) {
      failed.push(`${s.signature}: ${String((e as Error)?.message ?? e)}`);
    }
  }
  if (failed.length) throw new Error(`${failed.length} of ${fresh.length} transactions not read yet (${failed.slice(0, 3).join("; ")})`);
  return fresh.length;
}
