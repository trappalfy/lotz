/**
 * The whole user path on a local stack: connect, select lots, upload, pay, see the ad on the board; a takeover by
 * someone else; claiming the refund on /me; hiding the ad from /admin.
 */
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import sharp from "sharp";
import { LocalLotz, TOKEN, loadKeypair } from "@lotz/local";
import { installTestWallet } from "./test-wallet";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const state = JSON.parse(readFileSync(join(ROOT, ".data/localnet.json"), "utf8")) as { programId: string; mint: string; treasury: string };
const admin = loadKeypair(join(ROOT, "keys/dev-wallet.json"));
const lotz = new LocalLotz(new Connection("http://127.0.0.1:18899", "confirmed"), admin, {
  programId: new PublicKey(state.programId),
  mint: new PublicKey(state.mint),
  tokenProgram: TOKEN_PROGRAM_ID,
  treasury: new PublicKey(state.treasury),
});

interface BoardJson {
  ads: { id: number; owner: string; x: number; y: number; w: number; h: number; hidden: boolean; image: string | null }[];
  lotAds: string;
}

async function board(page: Page): Promise<BoardJson> {
  return (await (await page.request.get("/api/board")).json()) as BoardJson;
}

function adIdAt(b: BoardJson, lx: number, ly: number): number {
  const bytes = Buffer.from(b.lotAds, "base64");
  return bytes.readUInt32LE((ly * 100 + lx) * 4);
}

/** Finds a free w x h spot on the board (top-left lot), scanning from (60, 20). */
function freeSpot(b: BoardJson, w: number, h: number): { x: number; y: number } {
  for (let y = 20; y < 100 - h; y++)
    for (let x = 60; x < 100 - w; x++) {
      let ok = true;
      for (let dy = 0; dy < h && ok; dy++) for (let dx = 0; dx < w && ok; dx++) if (adIdAt(b, x + dx, y + dy)) ok = false;
      if (ok) return { x, y };
    }
  throw new Error("no free spot");
}

async function lotPoint(page: Page, lx: number, ly: number): Promise<{ x: number; y: number }> {
  const box = (await page.locator("#board canvas[role=img]").boundingBox())!;
  const k = box.width / 1000;
  return { x: box.x + (lx * 10 + 5) * k, y: box.y + (ly * 10 + 5) * k };
}

async function connect(page: Page) {
  await page.getByRole("button", { name: "Connect wallet" }).first().click();
  await page.getByRole("button", { name: /Lotz Test Wallet/ }).click();
  await expect(page.getByRole("button", { name: /…/ }).first()).toBeVisible();
}

async function selectRect(page: Page, x: number, y: number, w: number, h: number) {
  await page.getByRole("button", { name: "Buy lots" }).click();
  const a = await lotPoint(page, x, y);
  const b = await lotPoint(page, x + w - 1, y + h - 1);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByRole("complementary", { name: "Buy lots" })).toBeVisible();
}

async function fillAndPay(page: Page, image: string, title: string) {
  await page.locator('input[type="file"]').setInputFiles(image);
  await page.getByLabel("Link").fill("https://example.com/e2e");
  await page.getByPlaceholder("Shown on hover").fill(title);
  await page.getByRole("button", { name: "Pay & post" }).click();
  await expect(page.getByText("Posted. Your ad is on the board.")).toBeVisible({ timeout: 90_000 });
}

test("buy, take over, claim, moderate", async ({ browser }) => {
  const alice = Keypair.generate();
  const bob = Keypair.generate();
  await lotz.fund(alice.publicKey, 1_000_000n * TOKEN);
  await lotz.fund(bob.publicKey, 1_000_000n * TOKEN);
  const dir = mkdtempSync(join(tmpdir(), "lotz-e2e-"));
  const red = join(dir, "red.png");
  writeFileSync(red, await sharp({ create: { width: 300, height: 200, channels: 3, background: "#e4002b" } }).png().toBuffer());
  const blue = join(dir, "blue.png");
  writeFileSync(blue, await sharp({ create: { width: 100, height: 100, channels: 3, background: "#0033a0" } }).png().toBuffer());

  // --- Alice buys 3 x 2 free lots
  const pa = await (await browser.newContext()).newPage();
  await installTestWallet(pa, alice);
  await pa.goto("/");
  await connect(pa);
  const spot = freeSpot(await board(pa), 3, 2);
  await selectRect(pa, spot.x, spot.y, 3, 2);
  await expect(pa.getByText("3 × 2 lots")).toBeVisible();
  await expect(pa.getByText("Goes to the lock", { exact: true })).toBeVisible();
  await fillAndPay(pa, red, "your coin, e2e");
  let aliceAd = 0;
  await expect
    .poll(async () => {
      const b = await board(pa);
      const ad = b.ads.find((a) => a.owner === alice.publicKey.toBase58());
      aliceAd = ad?.id ?? 0;
      return ad && !ad.hidden && !!ad.image && adIdAt(b, spot.x, spot.y) === ad.id;
    }, { timeout: 30_000 })
    .toBe(true);

  // --- Bob takes one of Alice's lots
  const pb = await (await browser.newContext()).newPage();
  await installTestWallet(pb, bob);
  await pb.goto("/");
  await connect(pb);
  await selectRect(pb, spot.x, spot.y, 1, 1);
  await expect(pb.getByText("Taken lots (1.5x)")).toBeVisible();
  await expect(pb.getByText("1 · 10,500")).toBeVisible();
  await fillAndPay(pb, blue, "your coin, taken");
  await expect.poll(async () => adIdAt(await board(pb), spot.x, spot.y) !== aliceAd, { timeout: 30_000 }).toBe(true);

  // --- Alice claims her refund on /me
  const before = await lotz.tokenBalance(alice.publicKey);
  await pa.goto("/me");
  await expect(pa.getByText("7,000 to claim")).toBeVisible({ timeout: 30_000 });
  await pa.getByRole("button", { name: "Claim", exact: true }).first().click();
  await expect(pa.getByText("Claimed. The tokens are in your wallet.")).toBeVisible({ timeout: 60_000 });
  expect((await lotz.tokenBalance(alice.publicKey)) - before).toBe(7_000n * TOKEN);

  // --- the admin hides Bob's ad
  const bobAd = adIdAt(await board(pb), spot.x, spot.y);
  const pm = await (await browser.newContext()).newPage();
  await installTestWallet(pm, admin);
  await pm.goto("/admin");
  await connect(pm);
  await pm.getByRole("button", { name: /Sign in as/ }).click();
  await expect(pm.getByRole("heading", { name: "New ads" })).toBeVisible();
  await pm.locator("li", { hasText: `#${bobAd}` }).getByRole("button", { name: "Hide" }).click();
  await expect(pm.getByText(`Ad ${bobAd} hidden.`)).toBeVisible();
  await expect.poll(async () => (await board(pm)).ads.find((a) => a.id === bobAd)?.hidden, { timeout: 15_000 }).toBe(true);
  await pm.locator("li", { hasText: `#${bobAd}` }).getByRole("button", { name: "Show again" }).click();
  await expect.poll(async () => (await board(pm)).ads.find((a) => a.id === bobAd)?.hidden, { timeout: 15_000 }).toBe(false);
});
