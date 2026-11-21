import { describe, expect, it } from "vitest";
import { clampCamera, fitCamera, lotToScreen, rectBetween, screenToLot, zoomAt, zoomOf } from "@/components/board/camera";
import { BoardData } from "@/lib/client/board-data";
import { explainError } from "@/lib/client/errors";

describe("camera", () => {
  it("fits, zooms to a point and clamps", () => {
    const c = fitCamera(1000);
    expect(screenToLot(c, 0, 0)).toEqual({ lx: 0, ly: 0 });
    expect(screenToLot(c, 999, 999)).toEqual({ lx: 99, ly: 99 });
    const z = zoomAt(c, 1000, 500, 500, 4);
    expect(zoomOf(z, 1000)).toBeCloseTo(4);
    // the point under the cursor stays put
    expect(screenToLot(z, 500, 500)).toEqual(screenToLot(c, 500, 500));
    expect(clampCamera({ s: 0.1, ox: -50, oy: 2000 }, 1000)).toEqual({ s: 1, ox: 0, oy: 0 });
    const half = fitCamera(500);
    expect(lotToScreen(half, 10, 10)).toEqual({ x: 50, y: 50 });
  });

  it("selection is anchored, at most max lots, inside the board", () => {
    expect(rectBetween(5, 5, 8, 6, 10)).toEqual({ x: 5, y: 5, w: 4, h: 2 });
    expect(rectBetween(5, 5, 2, 1, 10)).toEqual({ x: 2, y: 1, w: 4, h: 5 });
    expect(rectBetween(5, 5, 40, 40, 10)).toEqual({ x: 5, y: 5, w: 10, h: 10 });
    expect(rectBetween(95, 95, 120, 120, 10)).toEqual({ x: 95, y: 95, w: 5, h: 5 });
    expect(rectBetween(3, 3, -5, -5, 10)).toEqual({ x: 0, y: 0, w: 4, h: 4 });
  });
});

describe("board data", () => {
  it("decodes packed lots and prices", () => {
    const ids = new Uint32Array(10_000);
    const idx = new Uint16Array(10_000);
    ids[0] = 7;
    idx[0] = 1;
    ids[101] = 7;
    idx[101] = 2;
    const b = new BoardData({
      params: { basePrice: "1000", tierSize: 1000, tierMultBps: 12500, takeoverMultBps: 15000, maxRect: 10, lotsSold: 2 },
      images: null,
      ads: [{ id: 7, address: "A", owner: "O", x: 0, y: 0, w: 2, h: 2, lotsAlive: 2, hidden: false, title: "t", link: "https://x.y", domain: "x.y", image: null, createdAt: "" }],
      lotAds: Buffer.from(ids.buffer).toString("base64"),
      lotPriceIdx: Buffer.from(idx.buffer).toString("base64"),
      prices: ["0", "1000", "1500"],
    });
    expect(b.adAt(0, 0)?.id).toBe(7);
    expect(b.adAt(1, 1)?.id).toBe(7);
    expect(b.adAt(2, 0)).toBeNull();
    expect(b.lotPrice(0, 0)).toBe(1500n); // taken: 1.5 x 1000
    expect(b.lotPrice(1, 1)).toBe(2250n);
    expect(b.lotPrice(5, 5)).toBe(1000n); // free, tier 0
  });
});

describe("errors", () => {
  it("explains program and wallet errors in plain words", () => {
    expect(explainError(new Error("User rejected the request."))).toBe("You cancelled in your wallet.");
    expect(explainError(new Error("custom program error: 0x177d"))).toMatch(/price changed/);
    expect(explainError(new Error('{"InstructionError":[1,{"Custom":6014}]}'))).toMatch(/already own/);
    expect(explainError(new Error("Blockhash not found"))).toMatch(/expired/);
  });
});
