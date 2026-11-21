/**
 * Demo content for a local board: abstract generated images, neutral titles ("your coin ..."), example.com links.
 * No real or invented tickers (brief §11).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { Keypair } from "@solana/web3.js";
import sharp from "sharp";
import { processUpload } from "@lotz/imaging";
import { LocalStorage } from "@lotz/storage";
import { TOKEN, type LocalLotz } from "./index";

const PALETTES = [
  ["#ff5a36", "#ffd23f", "#0a0a0a"],
  ["#2b59c3", "#ffffff", "#ff4f79"],
  ["#00a676", "#f6f740", "#0a0a0a"],
  ["#7b2cbf", "#ff9e00", "#ffffff"],
  ["#ef476f", "#06d6a0", "#118ab2"],
  ["#111111", "#f8f8f8", "#ff3b30"],
  ["#f72585", "#4cc9f0", "#3a0ca3"],
  ["#264653", "#e9c46a", "#e76f51"],
];

/** A blocky abstract picture (stripes, checks, rings or a big dot) at w*40 x h*40. */
async function art(w: number, h: number, seed: number): Promise<Uint8Array> {
  const W = w * 40;
  const H = h * 40;
  const [a, b, c] = PALETTES[seed % PALETTES.length]!;
  const kind = seed % 4;
  let shapes = "";
  if (kind === 0) {
    for (let i = 0; i < W + H; i += 20) shapes += `<polygon points="${i},0 ${i + 10},0 ${i + 10 - H},${H} ${i - H},${H}" fill="${b}"/>`;
  } else if (kind === 1) {
    for (let y = 0; y < H; y += 20) for (let x = 0; x < W; x += 20) if ((x + y) % 40 === 0) shapes += `<rect x="${x}" y="${y}" width="20" height="20" fill="${b}"/>`;
  } else if (kind === 2) {
    const r = Math.min(W, H);
    for (let i = 5; i > 0; i--) shapes += `<circle cx="${W / 2}" cy="${H / 2}" r="${(r / 2) * (i / 5)}" fill="${i % 2 ? b : c}"/>`;
  } else {
    shapes = `<circle cx="${W * 0.62}" cy="${H * 0.4}" r="${Math.min(W, H) * 0.3}" fill="${b}"/><rect x="0" y="${H * 0.78}" width="${W}" height="${H * 0.22}" fill="${c}"/>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" shape-rendering="crispEdges"><rect width="${W}" height="${H}" fill="${a}"/>${shapes}</svg>`;
  return new Uint8Array(await sharp(Buffer.from(svg)).png().toBuffer());
}

const TITLES = ["your coin", "your coin here", "your community", "your coin, live", "your chart", "your coin on the board"];

export async function seedDemo(
  lotz: LocalLotz,
  o: { storageDir: string; publicBase: string; walletsFile: string },
): Promise<void> {
  const storage = new LocalStorage(o.storageDir, o.publicBase);
  let wallets: Keypair[];
  if (existsSync(o.walletsFile)) {
    wallets = (JSON.parse(readFileSync(o.walletsFile, "utf8")) as number[][]).map((k) => Keypair.fromSecretKey(Uint8Array.from(k)));
  } else {
    wallets = Array.from({ length: 8 }, () => Keypair.generate());
    writeFileSync(o.walletsFile, JSON.stringify(wallets.map((k) => Array.from(k.secretKey))), { mode: 0o600 });
  }
  for (const w of wallets) await lotz.fund(w.publicKey, 100_000_000n * TOKEN, 5);

  const plan: { who: number; x: number; y: number; w: number; h: number }[] = [
    { who: 0, x: 4, y: 4, w: 10, h: 10 },
    { who: 1, x: 20, y: 6, w: 8, h: 5 },
    { who: 2, x: 42, y: 10, w: 6, h: 6 },
    { who: 3, x: 60, y: 3, w: 10, h: 4 },
    { who: 4, x: 75, y: 20, w: 5, h: 9 },
    { who: 5, x: 10, y: 30, w: 7, h: 7 },
    { who: 6, x: 33, y: 40, w: 10, h: 10 },
    { who: 7, x: 55, y: 55, w: 9, h: 6 },
    { who: 0, x: 80, y: 70, w: 4, h: 4 },
    { who: 1, x: 15, y: 70, w: 10, h: 8 },
    { who: 2, x: 47, y: 80, w: 3, h: 3 },
    { who: 3, x: 90, y: 88, w: 6, h: 6 },
    // takeovers: a hole in the first ad, then the same lot again and again
    { who: 4, x: 8, y: 8, w: 3, h: 3 },
    { who: 5, x: 9, y: 9, w: 2, h: 2 },
    { who: 6, x: 9, y: 9, w: 1, h: 1 },
    { who: 7, x: 9, y: 9, w: 1, h: 1 },
    { who: 1, x: 35, y: 42, w: 4, h: 3 },
  ];
  let n = 0;
  for (const p of plan) {
    const src = await art(p.w, p.h, n + 3);
    const img = await processUpload(src, p.w, p.h);
    const uri = await storage.put(`i/${img.hash}.webp`, img.bytes, "image/webp");
    try {
      await lotz.buy(wallets[p.who]!, p, {
        imageUri: uri,
        imageHash: Uint8Array.from(Buffer.from(img.hash, "hex")),
        title: TITLES[n % TITLES.length]!,
        link: `https://example.com/your-coin/${n + 1}`,
        maxTotal: 2n ** 64n - 1n,
      });
      console.log(`seeded ${p.w}x${p.h} at ${p.x},${p.y}`);
    } catch (e) {
      console.log(`skipped ${p.x},${p.y}: ${String((e as Error).message).split("\n")[0]}`);
    }
    n++;
  }
}
