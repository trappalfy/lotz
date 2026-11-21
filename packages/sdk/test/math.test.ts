import { describe, expect, it } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  applyShard,
  bs58,
  buyComputeUnits,
  buyEpoch,
  decodeShard,
  displayTitle,
  emptyBoard,
  encodeBuy,
  coder,
  epochAt,
  formatCompact,
  formatTokens,
  formatTokensExact,
  linkDomain,
  linkError,
  lotIndex,
  parseEvents,
  parseTokens,
  priceAfterTakeovers,
  quoteRect,
  shardsForRect,
  takeoverPrice,
  tierOf,
  tierPrice,
  titleError,
  toTokens,
  unlockAt,
  LotzInstructions,
  IDL_PROGRAM_ID,
} from "../src";

describe("math mirrors the program", () => {
  it("tier ladder (same values as programs/lotz/src/math.rs)", () => {
    const base = 1_000_000n;
    expect(tierPrice(base, 12_500, 0)).toBe(1_000_000n);
    expect(tierPrice(base, 12_500, 1)).toBe(1_250_000n);
    expect(tierPrice(base, 12_500, 2)).toBe(1_562_500n);
    expect(tierPrice(base, 12_500, 9)).toBe(7_450_577n);
    expect(tierPrice(1_000_000_000n, 12_500, 9)).toBe(7_450_580_595n);
    expect(tierOf(999, 1000)).toBe(0);
    expect(tierOf(1000, 1000)).toBe(1);
    expect(tierOf(9999, 1000)).toBe(9);
  });

  it("takeover rounds up", () => {
    expect(takeoverPrice(100n)).toBe(150n);
    expect(takeoverPrice(101n)).toBe(152n);
    expect(takeoverPrice(1n)).toBe(2n);
  });

  it("one lot's ladder", () => {
    const ladder = [0, 1, 2, 3, 4, 5, 6].map((n) => priceAfterTakeovers(1_000_000n, n));
    expect(ladder).toEqual([1_000_000n, 1_500_000n, 2_250_000n, 3_375_000n, 5_062_500n, 7_593_750n, 11_390_625n]);
  });

  it("epochs", () => {
    expect(epochAt(1_000, 1_000, 7)).toBe(0);
    expect(epochAt(1_006, 1_000, 7)).toBe(0);
    expect(epochAt(1_007, 1_000, 7)).toBe(1);
    expect(epochAt(500, 1_000, 7)).toBe(0);
    expect(unlockAt(3, 1_000, 7, 365)).toBe(1_000 + 28 + 365);
    const cfg = { launchTs: 0, epochLen: 604_800 };
    expect(buyEpoch(100, cfg)).toBe(0);
    expect(buyEpoch(604_800 - 30, cfg)).toBe(1);
    expect(buyEpoch(604_800, cfg)).toBe(1);
  });
});

describe("board", () => {
  it("shards for a rectangle, ascending", () => {
    expect(shardsForRect({ x: 0, y: 0, w: 1, h: 1 })).toEqual([0]);
    expect(shardsForRect({ x: 5, y: 5, w: 10, h: 10 })).toEqual([0, 1, 10, 11]);
    expect(shardsForRect({ x: 90, y: 95, w: 10, h: 5 })).toEqual([99]);
    expect(shardsForRect({ x: 8, y: 0, w: 4, h: 1 })).toEqual([0, 1]);
  });

  it("decodes a shard and quotes a mixed rectangle", () => {
    const data = new Uint8Array(8 + 1600 + 8);
    const view = new DataView(data.buffer);
    // shard 0: lot (0,0) ad 1 at 100, lot (1,0) ad 2 at 101
    view.setBigUint64(8, 1n, true);
    view.setBigUint64(16, 100n, true);
    view.setBigUint64(24, 2n, true);
    view.setBigUint64(32, 101n, true);
    data[8 + 1600] = 0;
    const shard = decodeShard(data);
    expect(shard.lots[0]).toEqual({ adId: 1, lastPrice: 100n });
    const board = emptyBoard();
    applyShard(board, shard);
    expect(board[lotIndex(1, 0)]).toEqual({ adId: 2, lastPrice: 101n });

    const q = quoteRect(
      board,
      { x: 0, y: 0, w: 3, h: 1 },
      { basePrice: 1_000n, tierSize: 1000, tierMultBps: 12_500, takeoverMultBps: 15_000, lotsSold: 2 },
    );
    expect(q.freeLots).toBe(1);
    expect(q.takenLots).toBe(2);
    expect(q.total).toBe(1_000n + 150n + 152n);
    expect(q.refunds).toBe(201n);
    expect(q.locked).toBe(1_000n + 50n + 51n);
    expect(q.priorAdIds).toEqual([1, 2]);
  });
});

describe("format and validate", () => {
  it("token amounts", () => {
    expect(toTokens(1_500_000n, 6)).toBe("1.5");
    expect(toTokens(1_000_000n, 6)).toBe("1");
    expect(formatTokens(1_250_000_000_000n, 6)).toBe("1,250,000");
    expect(formatCompact(48_200_000_000_000n, 6)).toBe("48.2M");
    expect(formatCompact(999n * 1_000_000n, 6)).toBe("999");
    expect(parseTokens("1,250.5", 6)).toBe(1_250_500_000n);
    expect(formatTokensExact(5_062_500_000n, 6)).toBe("5,062.5");
    expect(formatTokensExact(1_234_567_891_000n, 6)).toBe("1,234,567.89");
  });

  it("links and titles", () => {
    expect(linkError("https://example.com/x")).toBeNull();
    expect(linkError("http://example.com")).not.toBeNull();
    expect(linkError("https://exa mple.com")).not.toBeNull();
    expect(linkError("https://localhost")).not.toBeNull();
    expect(linkDomain("https://www.Example.com/a?b")).toBe("example.com");
    expect(linkDomain("javascript:alert(1)")).toBeNull();
    expect(titleError("a".repeat(64))).toBeNull();
    expect(titleError("a".repeat(65))).not.toBeNull();
    expect(titleError("🟩".repeat(64))).toBeNull();
    expect(titleError("a\nb")).not.toBeNull();
  });

  it("display titles drop bidi and invisible characters", () => {
    expect(displayTitle("abc\u202Edcba")).toBe("abcdcba");
    expect(displayTitle("a\u200Bb  c\n")).toBe("ab c");
    expect(displayTitle("🟩 your coin")).toBe("🟩 your coin");
  });

  it("base58", () => {
    const k = Keypair.generate().publicKey;
    expect(bs58(k.toBytes())).toBe(k.toBase58());
    expect(bs58(new Uint8Array([0, 0, 1]))).toBe("112");
  });
});

describe("instructions and events", () => {
  const deployment = {
    programId: IDL_PROGRAM_ID,
    mint: Keypair.generate().publicKey,
    tokenProgram: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
    treasury: Keypair.generate().publicKey,
  };
  const ixs = new LotzInstructions(deployment);

  it("buy has the named accounts, then shards, then prior ads", () => {
    const buyer = Keypair.generate().publicKey;
    const prior = [Keypair.generate().publicKey];
    const ix = ixs.buy(
      buyer,
      {
        nonce: 9n,
        x: 5,
        y: 5,
        w: 10,
        h: 10,
        epoch: 0,
        maxTotal: 10n,
        imageHash: new Uint8Array(32).fill(1),
        imageUri: "https://cdn/x.webp",
        link: "https://example.com",
        title: "your coin",
      },
      prior,
    );
    expect(ix.keys).toHaveLength(10 + 4 + 1);
    expect(ix.keys[0]!.pubkey.equals(buyer)).toBe(true);
    expect(ix.keys[0]!.isSigner).toBe(true);
    expect(ix.keys[10]!.pubkey.equals(ixs.pdas.shard(0))).toBe(true);
    expect(ix.keys[13]!.pubkey.equals(ixs.pdas.shard(11))).toBe(true);
    expect(ix.keys[14]!.pubkey.equals(prior[0]!)).toBe(true);
    expect(ix.keys[14]!.isWritable).toBe(true);
  });

  it("encodes buy args the program can decode", () => {
    const data = encodeBuy({
      nonce: 2n ** 63n,
      x: 1,
      y: 2,
      w: 3,
      h: 4,
      epoch: 7,
      maxTotal: 2n ** 64n - 1n,
      imageHash: new Uint8Array(32).fill(9),
      imageUri: "u",
      link: "https://a.b",
      title: "🟩",
    });
    const decoded = coder.instruction.decode(data) as { name: string; data: { args: Record<string, unknown> } };
    expect(decoded.name).toBe("buy");
    expect(String(decoded.data.args.max_total)).toBe((2n ** 64n - 1n).toString());
    expect(decoded.data.args.title).toBe("🟩");
  });

  it("parses only events logged by our program", () => {
    // Event bytes: discriminator + borsh(PausedSet { paused: true })
    const disc = (coder as unknown as { events: { layouts: Map<string, { discriminator: number[] }> } }).events
      .layouts;
    const pausedDisc = [...disc.entries()].find(([k]) => k === "PausedSet")![1].discriminator;
    const b64 = Buffer.from([...pausedDisc, 1]).toString("base64");
    const ours = IDL_PROGRAM_ID.toBase58();
    const other = Keypair.generate().publicKey.toBase58();
    const logs = [
      `Program ${ours} invoke [1]`,
      `Program data: ${b64}`,
      `Program ${other} invoke [2]`,
      `Program data: ${b64}`,
      `Program ${other} success`,
      `Program ${ours} success`,
      `Program ${other} invoke [1]`,
      `Program data: ${b64}`,
      `Program ${other} success`,
    ];
    const events = parseEvents(logs, IDL_PROGRAM_ID);
    expect(events).toEqual([{ name: "PausedSet", paused: true }]);
  });

  it("compute units", () => {
    // LiteSVM measurements (programs/lotz/tests/compute.rs) with margin
    expect(buyComputeUnits(100, 16)).toBeGreaterThan(148_063 * 1.3);
    expect(buyComputeUnits(16, 16)).toBeGreaterThan(141_514 * 1.3);
    expect(buyComputeUnits(1, 0)).toBeGreaterThan(36_000 * 1.5);
  });
});
