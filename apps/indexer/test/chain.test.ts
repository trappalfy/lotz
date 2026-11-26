import { afterEach, describe, expect, it, vi } from "vitest";
import { Connection, PublicKey } from "@solana/web3.js";
import { Chain } from "../src/chain";

const chain = new Chain(new Connection("http://rpc.test"), new PublicKey("LotzPiCxGrRhn8of391L6gPNTMnWXNwUdKyuiSoJaaa"));

afterEach(() => vi.unstubAllGlobals());

describe("Chain.transaction", () => {
  it("reads a version 1 transaction (web3.js 1.x cannot) and asks for it", async () => {
    let asked: unknown;
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      asked = JSON.parse(String(init.body));
      return Response.json({
        jsonrpc: "2.0",
        id: 1,
        result: { slot: 42, blockTime: 1_700_000_000, version: 1, meta: { err: null, logMessages: ["Program log: hi"] }, transaction: {} },
      });
    });
    expect(await chain.transaction("sig")).toEqual({ slot: 42, blockTime: 1_700_000_000, err: null, logs: ["Program log: hi"] });
    expect(asked).toMatchObject({ method: "getTransaction", params: ["sig", { maxSupportedTransactionVersion: 1, commitment: "confirmed" }] });
  });

  it("null when the RPC does not have it yet; throws on an RPC error", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ jsonrpc: "2.0", id: 1, result: null }));
    expect(await chain.transaction("sig")).toBeNull();
    vi.stubGlobal("fetch", async () => Response.json({ jsonrpc: "2.0", id: 1, error: { code: -32602, message: "bad" } }));
    await expect(chain.transaction("sig")).rejects.toThrow(/bad/);
  });
});
