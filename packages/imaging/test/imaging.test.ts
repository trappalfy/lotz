import { describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  ImageError,
  centerCrop,
  decodeAdImage,
  hiddenLotPattern,
  isApng,
  isPublicAddress,
  processUpload,
  sha256Hex,
  sniffFormat,
  probe,
} from "../src";
import { glyph, glyphTableValid, textCells } from "../src/pixel-font";

async function png(width: number, height: number, color = { r: 200, g: 10, b: 10 }, alpha = 1): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp({ create: { width, height, channels: 4, background: { ...color, alpha } } }).png().toBuffer(),
  );
}

describe("upload processing", () => {
  it("crops, resizes to 40 px per lot, hashes the stored bytes", async () => {
    const src = await png(800, 400);
    const out = await processUpload(src, 4, 2);
    expect(out.width).toBe(160);
    expect(out.height).toBe(80);
    expect(out.hash).toBe(sha256Hex(out.bytes));
    expect(sniffFormat(out.bytes)).toBe("webp");
    const meta = await sharp(out.bytes).metadata();
    expect([meta.width, meta.height]).toEqual([160, 80]);
    expect(meta.exif).toBeUndefined();
  });

  it("is deterministic (same input, same hash)", async () => {
    const src = await png(300, 300, { r: 1, g: 2, b: 3 });
    const a = await processUpload(src, 3, 3);
    const b = await processUpload(src, 3, 3);
    expect(a.hash).toBe(b.hash);
  });

  it("flattens transparency onto white", async () => {
    const src = await png(40, 40, { r: 0, g: 0, b: 0 }, 0);
    const out = await processUpload(src, 1, 1);
    const raw = await sharp(out.bytes).raw().toBuffer();
    expect([raw[0], raw[1], raw[2]]).toEqual([255, 255, 255]);
  });

  it("uses the requested crop", async () => {
    // left half red, right half blue; crop the right half
    const left = await sharp({ create: { width: 100, height: 100, channels: 3, background: "#ff0000" } }).png().toBuffer();
    const src = new Uint8Array(
      await sharp({ create: { width: 200, height: 100, channels: 3, background: "#0000ff" } })
        .composite([{ input: left, left: 0, top: 0 }])
        .png()
        .toBuffer(),
    );
    const out = await processUpload(src, 1, 1, { left: 100, top: 0, width: 100, height: 100 });
    const raw = await sharp(out.bytes).raw().toBuffer();
    expect(raw[2]).toBeGreaterThan(200);
    expect(raw[0]).toBeLessThan(50);
    await expect(processUpload(src, 1, 1, { left: 150, top: 0, width: 100, height: 100 })).rejects.toThrow(ImageError);
  });

  it("refuses non-images, oversize, wrong sizes and animations", async () => {
    await expect(probe(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow(/PNG, JPG or WebP/);
    await expect(probe(new Uint8Array(2 * 1024 * 1024 + 1))).rejects.toThrow(/2 MB/);
    await expect(processUpload(await png(10, 10), 11, 1)).rejects.toThrow(/rectangle/);
    const gif = new Uint8Array(await sharp({ create: { width: 4, height: 4, channels: 3, background: "#000" } }).gif().toBuffer());
    await expect(probe(gif)).rejects.toThrow(/PNG, JPG or WebP/);
    const f1 = await sharp({ create: { width: 4, height: 4, channels: 4, background: "#f00" } }).png().toBuffer();
    const f2 = await sharp({ create: { width: 4, height: 4, channels: 4, background: "#00f" } }).png().toBuffer();
    const animated = new Uint8Array(await sharp([f1, f2], { join: { animated: true } }).webp().toBuffer());
    expect(sniffFormat(animated)).toBe("webp");
    await expect(probe(animated)).rejects.toThrow(/Animated/);
  });

  it("detects APNG", () => {
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    const chunk = (type: string, len = 0) => [0, 0, 0, len, ...[...type].map((c) => c.charCodeAt(0)), ...Array(len).fill(0), 0, 0, 0, 0];
    expect(isApng(new Uint8Array([...sig, ...chunk("IHDR", 13), ...chunk("acTL", 8), ...chunk("IDAT")]))).toBe(true);
    expect(isApng(new Uint8Array([...sig, ...chunk("IHDR", 13), ...chunk("IDAT"), ...chunk("acTL", 8)]))).toBe(false);
  });

  it("center crop keeps the rectangle's ratio", () => {
    expect(centerCrop(1000, 500, 1, 1)).toEqual({ left: 250, top: 0, width: 500, height: 500 });
    expect(centerCrop(500, 1000, 2, 1)).toEqual({ left: 0, top: 375, width: 500, height: 250 });
  });
});

describe("rendering helpers", () => {
  it("decodes any image to exactly w*40 x h*40 RGBA", async () => {
    const raw = await decodeAdImage(await png(123, 77), 3, 2);
    expect(raw.length).toBe(120 * 80 * 4);
  });

  it("hidden pattern is grid/paper", () => {
    const p = hiddenLotPattern();
    expect(p.length).toBe(40 * 40 * 4);
    expect([p[0], p[1], p[2]]).toEqual([0xde, 0xde, 0xde]);
    const i = 4 * 4; // x = 4: next logical pixel
    expect([p[i], p[i + 1], p[i + 2]]).toEqual([0xff, 0xff, 0xff]);
  });

  it("pixel font", () => {
    expect(glyphTableValid()).toBe(true);
    expect(glyph("l")).toHaveLength(7);
    expect(textCells("lotz.fun")[0]).toHaveLength(8 * 6 - 1);
    expect(textCells("lotz.fun").flat().filter(Boolean).length).toBeGreaterThan(40);
  });
});

describe("ssrf guard", () => {
  it("classifies addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "100.64.0.1", "224.0.0.1"]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
    for (const ip of ["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111", "172.32.0.1"]) expect(isPublicAddress(ip), ip).toBe(true);
  });
});
