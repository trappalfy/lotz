import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const PRIMARY = "https://primary.rpc.test/?api-key=k";
const PUBLIC = "https://api.mainnet-beta.solana.com";
const call = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getSlot", params: [] });
const ok = (from: string) => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: from }), { status: 200 });

let answers: Record<string, () => Response | Promise<Response>>;
let calls: string[];

beforeEach(() => {
  vi.stubEnv("RPC_URL", PRIMARY);
  vi.stubEnv("NEXT_PUBLIC_CLUSTER", "mainnet-beta");
  calls = [];
  vi.stubGlobal("fetch", async (url: string) => {
    calls.push(url);
    return answers[url]!();
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function post(body = call, ip = `10.0.0.${Math.floor(Math.random() * 250)}`) {
  const { POST } = await import("../app/api/rpc/route");
  const res = await POST(new Request("https://lotz.test/api/rpc", { method: "POST", body, headers: { "x-forwarded-for": ip } }));
  const text = await res.text();
  let json: { result?: string; error?: { code: number } } = {};
  try {
    json = JSON.parse(text) as typeof json;
  } catch {
    /* a plain-text answer, passed on as it came */
  }
  return { status: res.status, json };
}

describe("/api/rpc", () => {
  it("uses the primary RPC while it answers", async () => {
    answers = { [PRIMARY]: () => ok("primary"), [PUBLIC]: () => ok("public") };
    expect((await post()).json.result).toBe("primary");
    expect(calls).toEqual([PRIMARY]);
  });

  it("goes to the public RPC when the primary is rate limited, failing or unreachable", async () => {
    for (const primary of [
      () => new Response("Too Many Requests", { status: 429 }),
      () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32429, message: "rate limited" } }), { status: 200 }),
      () => new Response("bad gateway", { status: 502 }),
      () => Promise.reject(new Error("ECONNRESET")),
    ]) {
      calls = [];
      answers = { [PRIMARY]: primary, [PUBLIC]: () => ok("public") };
      const r = await post();
      expect(r.status).toBe(200);
      expect(r.json.result).toBe("public");
      expect(calls).toEqual([PRIMARY, PUBLIC]);
    }
  });

  it("keeps the primary's answer when the fallback fails too", async () => {
    answers = { [PRIMARY]: () => new Response("Too Many Requests", { status: 429 }), [PUBLIC]: () => new Response("no", { status: 503 }) };
    expect((await post()).status).toBe(429);
  });

  it("has no fallback off mainnet, and none when told so", async () => {
    answers = { [PRIMARY]: () => new Response("Too Many Requests", { status: 429 }), [PUBLIC]: () => ok("public") };
    vi.stubEnv("NEXT_PUBLIC_CLUSTER", "localnet");
    expect((await post()).status).toBe(429);
    vi.stubEnv("NEXT_PUBLIC_CLUSTER", "mainnet-beta");
    vi.stubEnv("RPC_FALLBACK_URL", "none");
    expect((await post()).status).toBe(429);
    expect(calls).toEqual([PRIMARY, PRIMARY]);
  });

  it("still refuses methods the site does not use", async () => {
    answers = { [PRIMARY]: () => ok("primary"), [PUBLIC]: () => ok("public") };
    const r = await post(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getProgramAccounts", params: [] }));
    expect(r.status).toBe(403);
    expect(calls).toEqual([]);
  });
});
