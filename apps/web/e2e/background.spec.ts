/** The background reacts to a purchase: a takeover lights cells outside the board, then they go out. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { LocalLotz, TOKEN, loadKeypair } from "@lotz/local";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const state = JSON.parse(readFileSync(join(ROOT, ".data/localnet.json"), "utf8")) as { programId: string; mint: string; treasury: string };
const admin = loadKeypair(join(ROOT, "keys/dev-wallet.json"));
const lotz = new LocalLotz(new Connection("http://127.0.0.1:18899", "confirmed"), admin, {
  programId: new PublicKey(state.programId),
  mint: new PublicKey(state.mint),
  tokenProgram: TOKEN_PROGRAM_ID,
  treasury: new PublicKey(state.treasury),
});

/** Ink pixels on the background canvas outside the board frame. */
async function inkOutsideBoard(page: import("@playwright/test").Page): Promise<number> {
  return page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>("canvas.fixed")!;
    const board = document.getElementById("board")!.getBoundingClientRect();
    const k = c.width / window.innerWidth;
    const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let y = 0; y < c.height; y += 3) {
      for (let x = 0; x < c.width; x += 3) {
        const sx = x / k;
        const sy = y / k;
        if (sx >= board.left && sx <= board.right && sy >= board.top && sy <= board.bottom) continue;
        if (d[(y * c.width + x) * 4 + 3]! > 0) n++;
      }
    }
    return n;
  });
}

test("a takeover flashes the star across the grid", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await page.waitForTimeout(1500);
  const idle = await inkOutsideBoard(page);
  const a = await lotz.fundedWallet(1_000_000n * TOKEN, 2);
  const b = await lotz.fundedWallet(1_000_000n * TOKEN, 2);
  // a lot in view, somewhere free in the lower middle of the board
  const spot = { x: 20 + Math.floor(Math.random() * 60), y: 52 + Math.floor(Math.random() * 3) };
  await lotz.buy(a, { ...spot, w: 1, h: 1 }, { maxTotal: 2n ** 64n - 1n }).catch(() => {});
  await page.waitForTimeout(2500);
  await lotz.buy(b, { ...spot, w: 1, h: 1 }, { maxTotal: 2n ** 64n - 1n });
  // the indexer is polling the websocket: the flash comes within a few seconds
  await expect.poll(() => inkOutsideBoard(page), { timeout: 20_000, intervals: [50] }).toBeGreaterThan(idle + 50);
  await page.screenshot({ path: "test-results/flash.png" });
  await page.waitForTimeout(2500);
  expect(await inkOutsideBoard(page)).toBeLessThan(idle + 20);
});

test("prefers-reduced-motion: no flash, no blinking", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto("/");
  await page.waitForTimeout(1500);
  const a = await lotz.fundedWallet(1_000_000n * TOKEN, 2);
  const b = await lotz.fundedWallet(1_000_000n * TOKEN, 2);
  const spot = { x: 20 + Math.floor(Math.random() * 60), y: 56 + Math.floor(Math.random() * 3) };
  await lotz.buy(a, { ...spot, w: 1, h: 1 }, { maxTotal: 2n ** 64n - 1n }).catch(() => {});
  await lotz.buy(b, { ...spot, w: 1, h: 1 }, { maxTotal: 2n ** 64n - 1n });
  let max = 0;
  const until = Date.now() + 8_000;
  while (Date.now() < until) {
    max = Math.max(max, await inkOutsideBoard(page));
    await page.waitForTimeout(40);
  }
  expect(max).toBe(0);
  await context.close();
});
