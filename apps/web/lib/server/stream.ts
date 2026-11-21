import "server-only";
import type { Client as PoolClient } from "@lotz/db";
import { STREAM_CHANNEL } from "@lotz/db";
import { pool } from "./db";
import { imagesJson } from "./views";

/** The indexer sends storage keys; clients get public URLs. */
function toClient(payload: string): string {
  try {
    const msg = JSON.parse(payload) as { board?: unknown };
    if (msg.board) msg.board = imagesJson(msg.board as Parameters<typeof imagesJson>[0]);
    return JSON.stringify(msg);
  } catch {
    return payload;
  }
}

type Listener = (payload: string) => void;

/** One LISTEN connection per server process, fanned out to every SSE client. */
class StreamHub {
  private listeners = new Set<Listener>();
  private client: PoolClient | null = null;
  private connecting: Promise<void> | null = null;

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    void this.ensure();
    return () => {
      this.listeners.delete(fn);
    };
  }

  get size(): number {
    return this.listeners.size;
  }

  private ensure(): Promise<void> {
    if (this.client) return Promise.resolve();
    this.connecting ??= (async () => {
      try {
        const client = await pool().connect();
        client.on("notification", (n) => {
          if (n.channel !== STREAM_CHANNEL || !n.payload) return;
          const out = toClient(n.payload);
          for (const l of this.listeners) {
            try {
              l(out);
            } catch {
              /* a closed stream; it unsubscribes itself */
            }
          }
        });
        const reset = () => {
          this.client = null;
          client.release(true);
          setTimeout(() => void this.ensure(), 1_000);
        };
        client.on("error", reset);
        client.on("end", reset);
        await client.query(`listen ${STREAM_CHANNEL}`);
        this.client = client;
      } catch {
        setTimeout(() => void this.ensure(), 2_000);
      } finally {
        this.connecting = null;
      }
    })();
    return this.connecting;
  }
}

const g = globalThis as unknown as { __lotzHub?: StreamHub };
export function hub(): StreamHub {
  g.__lotzHub ??= new StreamHub();
  return g.__lotzHub;
}
