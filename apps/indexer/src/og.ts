/**
 * OG card, 1200 x 630 (brief §9): a snapshot of the board with its frame and rulers on the background grid, and
 * `lotz.fun` written in cells. Drawn into a raw buffer (no fonts involved), then the board image is composited.
 */
import sharp from "sharp";
import { COLORS } from "@lotz/imaging";
import { textCells } from "@lotz/imaging/pixel-font";
import { STAR, downsample } from "@lotz/brand";

const W = 1200;
const H = 630;
const GRID = 10;
/** Board snapshot: 500 x 500 px (each lot 5 px), placed on the grid. */
const BOARD = { x: 80, y: 70, size: 500 };

type RGB = readonly [number, number, number];

class Canvas {
  readonly buf = Buffer.alloc(W * H * 4);
  fill(x: number, y: number, w: number, h: number, c: RGB): void {
    for (let yy = Math.max(0, y); yy < Math.min(H, y + h); yy++) {
      for (let xx = Math.max(0, x); xx < Math.min(W, x + w); xx++) {
        const i = (yy * W + xx) * 4;
        this.buf[i] = c[0];
        this.buf[i + 1] = c[1];
        this.buf[i + 2] = c[2];
        this.buf[i + 3] = 255;
      }
    }
  }
  cells(cells: boolean[][], x: number, y: number, cell: number, c: RGB, gap = 0): void {
    cells.forEach((row, cy) =>
      row.forEach((on, cx) => {
        if (on) this.fill(x + cx * cell + gap, y + cy * cell + gap, cell - gap * 2, cell - gap * 2, c);
      }),
    );
  }
}

export async function renderOg(board1x: Uint8Array | null): Promise<Buffer> {
  const c = new Canvas();
  c.fill(0, 0, W, H, COLORS.paper);
  for (let x = 0; x < W; x += GRID) c.fill(x, 0, 1, H, COLORS.grid);
  for (let y = 0; y < H; y += GRID) c.fill(0, y, W, 1, COLORS.grid);

  // rulers: ticks every 100 logical px (50 px here), labels in a small cell font
  const { x: bx, y: by, size } = BOARD;
  for (let i = 0; i <= 10; i++) {
    const t = i * (size / 10);
    const long = i % 5 === 0 ? 14 : 8;
    c.fill(bx + t - (i === 10 ? 2 : 0), by - long, 2, long, COLORS.ink);
    c.fill(bx - long, by + t - (i === 10 ? 2 : 0), long, 2, COLORS.ink);
    if (i % 5 === 0) {
      const label = textCells(String(i * 100));
      const lw = label[0]!.length * 2;
      c.cells(label, bx + t - Math.floor(lw / 2), by - long - 18, 2, COLORS.mute);
      c.cells(label, Math.max(2, bx - long - 4 - lw), by + t + (i === 0 ? 2 : -7), 2, COLORS.mute);
    }
  }
  // frame (2 px, outside the board) and the board's white base
  c.fill(bx - 2, by - 2, size + 4, size + 4, COLORS.ink);
  c.fill(bx, by, size, size, COLORS.paper);
  for (let i = 0; i <= size; i += 50) {
    c.fill(bx + Math.min(i, size - 1), by, 1, size, COLORS.gridStrong);
    c.fill(bx, by + Math.min(i, size - 1), size, 1, COLORS.gridStrong);
  }

  // the star and `lotz.fun`, on the 10 px grid
  const star = downsample(STAR, 3, 0.2);
  c.cells(star, 640, 70, GRID, COLORS.ink, 0);
  c.cells(textCells("lotz.fun"), 640, 330, GRID, COLORS.ink, 0);
  c.cells(textCells("1,000,000 pixels"), 640, 430, 4, COLORS.mute, 0);

  let img = sharp(c.buf, { raw: { width: W, height: H, channels: 4 } });
  if (board1x) {
    const board = await sharp(board1x).resize(size, size, { kernel: "lanczos3" }).png().toBuffer();
    img = sharp(await img.png().toBuffer()).composite([{ input: board, left: bx, top: by }]);
  }
  return img.png({ compressionLevel: 8 }).toBuffer();
}
