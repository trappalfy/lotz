/**
 * Board renderer (brief §4 "Рендер доски"). Keeps the whole board at 4x (4000 x 4000 RGBA) in memory; every lot
 * shows the matching 40 x 40 piece of its current ad's image, hidden ads show the grid pattern, free lots are
 * transparent (the site's grid shows through). Publishes:
 * - `board/1x-{v}.png` (1000 x 1000) and `board/2x-{v}.png` (2000 x 2000) after every change;
 * - 16 tiles at 4x, `board/t/{tx}-{ty}-{v}.png`, each 25 x 25 lots (1000 x 1000 px), only the changed ones.
 */
import sharp from "sharp";
import { BOARD_SIDE } from "@lotz/sdk";
import { LOT_IMAGE_PX, hiddenLotPattern } from "@lotz/imaging";
import { IMMUTABLE, type Storage } from "@lotz/storage";
import type { BoardImages } from "@lotz/db";

export const BOARD_4X = BOARD_SIDE * LOT_IMAGE_PX; // 4000
export const TILE_LOTS = 25;
export const TILES_PER_SIDE = BOARD_SIDE / TILE_LOTS; // 4
export const TILE_PX = TILE_LOTS * LOT_IMAGE_PX; // 1000

/** What a lot shows. */
export type LotPaint =
  | { kind: "free" }
  | { kind: "hidden" }
  | { kind: "image"; raw: Buffer; adX: number; adY: number; adW: number };

const HIDDEN = hiddenLotPattern();
const ROW = LOT_IMAGE_PX * 4;

export function tileOf(lx: number, ly: number): number {
  return Math.floor(ly / TILE_LOTS) * TILES_PER_SIDE + Math.floor(lx / TILE_LOTS);
}

export class BoardRenderer {
  readonly buf = Buffer.alloc(BOARD_4X * BOARD_4X * 4);
  private dirtyTiles = new Set<number>();

  /** Paints one lot into the buffer and marks its tile dirty. */
  paint(lx: number, ly: number, p: LotPaint): void {
    const dst0 = (ly * LOT_IMAGE_PX * BOARD_4X + lx * LOT_IMAGE_PX) * 4;
    for (let row = 0; row < LOT_IMAGE_PX; row++) {
      const dst = dst0 + row * BOARD_4X * 4;
      if (p.kind === "free") {
        this.buf.fill(0, dst, dst + ROW);
      } else if (p.kind === "hidden") {
        HIDDEN.copy(this.buf, dst, row * ROW, row * ROW + ROW);
      } else {
        const sx = (lx - p.adX) * LOT_IMAGE_PX;
        const sy = (ly - p.adY) * LOT_IMAGE_PX + row;
        const srcW = p.adW * LOT_IMAGE_PX;
        const src = (sy * srcW + sx) * 4;
        p.raw.copy(this.buf, dst, src, src + ROW);
      }
    }
    this.dirtyTiles.add(tileOf(lx, ly));
  }

  markAllDirty(): void {
    for (let i = 0; i < TILES_PER_SIDE * TILES_PER_SIDE; i++) this.dirtyTiles.add(i);
  }

  hasDirty(): boolean {
    return this.dirtyTiles.size > 0;
  }

  /** RGBA of one 4x tile. */
  tileRaw(tile: number): Buffer {
    const tx = tile % TILES_PER_SIDE;
    const ty = Math.floor(tile / TILES_PER_SIDE);
    const out = Buffer.alloc(TILE_PX * TILE_PX * 4);
    for (let row = 0; row < TILE_PX; row++) {
      const src = ((ty * TILE_PX + row) * BOARD_4X + tx * TILE_PX) * 4;
      this.buf.copy(out, row * TILE_PX * 4, src, src + TILE_PX * 4);
    }
    return out;
  }

  async scaled(size: number): Promise<Buffer> {
    return sharp(this.buf, { raw: { width: BOARD_4X, height: BOARD_4X, channels: 4 } })
      .resize(size, size, { kernel: "lanczos3" })
      .png({ compressionLevel: 6 })
      .toBuffer();
  }

  /** Encodes and uploads what changed since the last publish; returns the new image set. */
  async publish(storage: Storage, previous: BoardImages | null): Promise<BoardImages> {
    const version = (previous?.version ?? 0) + 1;
    const tiles = previous?.tiles.slice() ?? [];
    const all = tiles.length !== TILES_PER_SIDE * TILES_PER_SIDE;
    const dirty = all ? Array.from({ length: TILES_PER_SIDE * TILES_PER_SIDE }, (_, i) => i) : [...this.dirtyTiles];
    this.dirtyTiles.clear();

    await Promise.all(
      dirty.map(async (t) => {
        const png = await sharp(this.tileRaw(t), { raw: { width: TILE_PX, height: TILE_PX, channels: 4 } })
          .png({ compressionLevel: 6 })
          .toBuffer();
        const key = `board/t/${t % TILES_PER_SIDE}-${Math.floor(t / TILES_PER_SIDE)}-${version}.png`;
        await storage.put(key, png, "image/png", IMMUTABLE);
        tiles[t] = key;
      }),
    );
    const [x1, x2] = await Promise.all([this.scaled(1000), this.scaled(2000)]);
    const x1Key = `board/1x-${version}.png`;
    const x2Key = `board/2x-${version}.png`;
    await Promise.all([
      storage.put(x1Key, x1, "image/png", IMMUTABLE),
      storage.put(x2Key, x2, "image/png", IMMUTABLE),
      // a stable name for tools and the OG renderer
      storage.put("board/latest-1x.png", x1, "image/png", "public, max-age=60"),
    ]);
    // Old versions stay a while for clients still loading them, then go.
    this.retired.push(...(previous ? [previous.x1, previous.x2, ...previous.tiles.filter((k, i) => tiles[i] !== k)] : []));
    const drop = this.retired.splice(0, Math.max(0, this.retired.length - 200));
    await Promise.all(drop.map((k) => storage.delete(k).catch(() => {})));
    return { version, renderedAt: new Date().toISOString(), x1: x1Key, x2: x2Key, tiles, og: previous?.og ?? null };
  }

  /** Keys of superseded images, oldest first; the newest 200 are kept. */
  private retired: string[] = [];
}
