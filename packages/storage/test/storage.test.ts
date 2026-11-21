import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LocalStorage, assertKey } from "../src";

describe("local storage", () => {
  it("puts, gets, maps urls and refuses path tricks", async () => {
    const s = new LocalStorage(mkdtempSync(join(tmpdir(), "lotz-storage-")), "http://localhost:3000/media/");
    const url = await s.put("i/abc.webp", new Uint8Array([1, 2, 3]), "image/webp");
    expect(url).toBe("http://localhost:3000/media/i/abc.webp");
    expect(s.keyOf(url)).toBe("i/abc.webp");
    expect(s.keyOf("https://elsewhere/i/abc.webp")).toBeNull();
    expect(Array.from((await s.get("i/abc.webp"))!)).toEqual([1, 2, 3]);
    expect(await s.get("i/missing.webp")).toBeNull();
    for (const bad of ["../x", "/etc/passwd", "a/../../b", "", "a b"]) expect(() => assertKey(bad)).toThrow();
    await expect(s.put("../escape", new Uint8Array(), "x")).rejects.toThrow();
  });
});
