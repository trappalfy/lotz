import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createHttpServer } from "../src/http";
import type { StreamMessage, StreamStats } from "../src/indexer";

const stats: StreamStats = { lotsSold: 3, takeovers: 1, totalLocked: "10", totalReleased: "0", freeLotPrice: "5", paused: false, supply: "1000", tokenUsd: null, priceAt: null, streamflowLocked: null };
const board = { version: 7, x1: "board/1x-7.png", x2: "board/2x-7.png", tiles: ["board/t/0-0-7.png"], og: null, renderedAt: "2026-11-21T00:00:00Z" };
const subscribers = new Set<(m: StreamMessage) => void>();
const signatures: string[] = [];

const fake = {
  subscribe(fn: (m: StreamMessage) => void) {
    subscribers.add(fn);
    return () => void subscribers.delete(fn);
  },
  snapshot: () => ({ board, stats }),
  handleSignature: async (s: string) => void signatures.push(s),
};

let server: Server;
let base: string;

beforeAll(async () => {
  server = createHttpServer({
    indexer: fake as never,
    storage: { publicUrl: (k: string) => `https://cdn.test/${k}` },
    webhookSecret: "s3cret",
    log: () => {},
    maxStreamsPerIp: 2,
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

/** Reads SSE `data:` lines until `count` arrived. */
async function read(res: Response, count: number): Promise<unknown[]> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const out: unknown[] = [];
  while (out.length < count) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value);
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      for (const line of chunk.split("\n")) if (line.startsWith("data: ")) out.push(JSON.parse(line.slice(6)));
    }
  }
  return out;
}

describe("indexer http", () => {
  it("streams a hello with public URLs, then every published message", async () => {
    const ac = new AbortController();
    const res = await fetch(`${base}/stream`, { signal: ac.signal });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const first = read(res, 2);
    await new Promise((r) => setTimeout(r, 50));
    for (const s of subscribers) s({ type: "pause", board, stats: { ...stats, paused: true } });
    const [hello, pause] = (await first) as { type: string; board: { x1: string }; stats: StreamStats }[];
    expect(hello!.type).toBe("hello");
    expect(hello!.board.x1).toBe("https://cdn.test/board/1x-7.png");
    expect(pause!.type).toBe("pause");
    expect(pause!.stats.paused).toBe(true);
    ac.abort();
    await new Promise((r) => setTimeout(r, 50));
    expect(subscribers.size).toBe(0);
  });

  it("caps open streams per client", async () => {
    const acs = [new AbortController(), new AbortController()];
    const open = await Promise.all(acs.map((ac) => fetch(`${base}/stream`, { signal: ac.signal })));
    expect(open.map((r) => r.status)).toEqual([200, 200]);
    const third = await fetch(`${base}/stream`);
    expect(third.status).toBe(503);
    for (const ac of acs) ac.abort();
    await new Promise((r) => setTimeout(r, 50));
    const again = new AbortController();
    expect((await fetch(`${base}/stream`, { signal: again.signal })).status).toBe(200);
    again.abort();
  });

  it("takes webhook signatures only with the secret", async () => {
    const sig = "5".repeat(88);
    const body = JSON.stringify([{ signature: sig }]);
    expect((await fetch(`${base}/webhooks/helius`, { method: "POST", body })).status).toBe(401);
    expect((await fetch(`${base}/webhooks/helius`, { method: "POST", body, headers: { authorization: "nope!!" } })).status).toBe(401);
    expect((await fetch(`${base}/webhooks/helius`, { method: "POST", body, headers: { authorization: "s3cret" } })).status).toBe(200);
    expect(signatures).toEqual([sig]);
  });

  it("answers health and 404", async () => {
    expect(await (await fetch(`${base}/health`)).json()).toMatchObject({ ok: true });
    expect((await fetch(`${base}/nope`)).status).toBe(404);
  });
});
