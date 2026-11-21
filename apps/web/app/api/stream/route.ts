import * as db from "@lotz/db";
import { pool } from "@/lib/server/db";
import { hub } from "@/lib/server/stream";
import { imagesJson, statsView } from "@/lib/server/views";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Server-sent events: purchases, takeovers and board updates as the indexer publishes them. */
export async function GET(req: Request) {
  const enc = new TextEncoder();
  let unsubscribe = () => {};
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (s: string) => {
        try {
          controller.enqueue(enc.encode(s));
        } catch {
          cleanup();
        }
      };
      const cleanup = () => {
        unsubscribe();
        if (heartbeat) clearInterval(heartbeat);
      };
      unsubscribe = hub().subscribe((payload) => send(`data: ${payload}\n\n`));
      heartbeat = setInterval(() => send(`: keep-alive\n\n`), 20_000);
      req.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
      const [images, stats] = await Promise.all([db.kvGet<db.BoardImages>(pool(), db.BOARD_IMAGES_KEY), statsView()]);
      send(`retry: 3000\n`);
      send(
        `data: ${JSON.stringify({
          type: "hello",
          board: imagesJson(images),
          stats: {
            lotsSold: stats.lotsSold,
            takeovers: stats.takeovers,
            totalLocked: stats.totalLocked,
            totalReleased: stats.totalReleased,
            freeLotPrice: stats.freeLotPrice,
            paused: stats.paused,
          },
        })}\n\n`,
      );
    },
    cancel() {
      unsubscribe();
      if (heartbeat) clearInterval(heartbeat);
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
