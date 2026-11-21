import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_THRESHOLDS, judge, regionsOf, screenImage, screenRaw, screeningFromEnv, warmUp } from "../src/index";

const zero = { Drawing: 0, Hentai: 0, Neutral: 0, Porn: 0, Sexy: 0 };

describe("judge", () => {
  it("flags explicit and very suggestive scores only", () => {
    expect(judge({ ...zero, Neutral: 1 })).toBe(false);
    expect(judge({ ...zero, Porn: 0.4, Hentai: 0.25 })).toBe(true);
    expect(judge({ ...zero, Sexy: 0.85 })).toBe(false);
    expect(judge({ ...zero, Sexy: 0.92 })).toBe(true);
  });

  it("reads settings from the environment", () => {
    expect(screeningFromEnv({})).toEqual(DEFAULT_THRESHOLDS);
    expect(screeningFromEnv({ NSFW_FILTER: "off" })).toBeNull();
    expect(screeningFromEnv({ NSFW_EXPLICIT: "0.8", NSFW_SUGGESTIVE: "nope" })).toEqual({ explicit: 0.8, suggestive: 0.9 });
  });
});

describe("regionsOf", () => {
  it("checks short images whole and long strips in 2:1 pieces that cover them", () => {
    expect(regionsOf(400, 400)).toEqual([{ left: 0, top: 0, width: 400, height: 400 }]);
    expect(regionsOf(400, 200)).toHaveLength(1);
    const strip = regionsOf(400, 40);
    expect(strip).toEqual([0, 80, 160, 240, 320].map((left) => ({ left, top: 0, width: 80, height: 40 })));
    const three = regionsOf(120, 40);
    expect(three).toEqual([
      { left: 0, top: 0, width: 80, height: 40 },
      { left: 40, top: 0, width: 80, height: 40 },
    ]);
    const tall = regionsOf(80, 400);
    expect(tall.map((r) => r.top)).toEqual([0, 120, 240]);
    expect(tall.every((r) => r.left === 0 && r.width === 80 && r.height === 160)).toBe(true);
  });
});

describe("the model", () => {
  const star = readFileSync(join(import.meta.dirname, "../../brand/assets/lotz-star.svg"));

  it("runs on the WebAssembly backend", async () => {
    expect(await warmUp()).toBe("wasm");
  }, 60_000);

  it("passes ordinary images", async () => {
    const png = await sharp(star).resize(400, 400).png().toBuffer();
    const v = await screenImage(png);
    expect(v.unsafe).toBe(false);
    expect(v.scores.Drawing + v.scores.Neutral).toBeGreaterThan(0.5);
  }, 60_000);

  it("takes raw RGBA pixels of a long ad", async () => {
    const { data, info } = await sharp({ create: { width: 400, height: 40, channels: 4, background: "#3366cc" } })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const v = await screenRaw(new Uint8Array(data), info.width, info.height, 4);
    expect(v.unsafe).toBe(false);
  }, 60_000);
});
