// Usage: node scripts/dev/shot.mjs <url> <out.png> [width] [height] [fullPage] [actions-json]
import { chromium } from "@playwright/test";
const [url, out, w = "1440", h = "1000", full = "0", actions = "[]"] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) }, deviceScaleFactor: 1 });
const logs = [];
page.on("console", (m) => (m.type() === "error" || m.type() === "warning") && logs.push(`${m.type()}: ${m.text()}`));
page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));
await page.goto(url, { waitUntil: "networkidle" }).catch(() => {});
await page.waitForTimeout(1200);
for (const a of JSON.parse(actions)) {
  if (a.scroll !== undefined) await page.evaluate((y) => window.scrollTo(0, y), a.scroll);
  if (a.move) await page.mouse.move(a.move[0], a.move[1]);
  if (a.click) await page.mouse.click(a.click[0], a.click[1]);
  if (a.down) { await page.mouse.move(a.down[0], a.down[1]); await page.keyboard.down("Shift"); await page.mouse.down(); }
  if (a.up) { await page.mouse.move(a.up[0], a.up[1], { steps: 5 }); await page.mouse.up(); await page.keyboard.up("Shift"); }
  if (a.wheel) { await page.mouse.move(a.wheel[0], a.wheel[1]); await page.mouse.wheel(0, a.wheel[2]); }
  if (a.selector) await page.click(a.selector);
  if (a.wait) await page.waitForTimeout(a.wait);
}
await page.waitForTimeout(500);
await page.screenshot({ path: out, fullPage: full === "1" });
console.log(logs.join("\n") || "no console errors");
await browser.close();
