/**
 * The share card for posts, 1200 x 675 (16:9): the share of the token supply in the lock, big, in the pixel font
 * on the site's grid, with the counts under it. Published at a fixed address (`share/lock.png`) and refreshed by
 * the indexer when the numbers change.
 */
import sharp from "sharp";
import { COLORS } from "@lotz/imaging";
import { textCells, GLYPH_W } from "@lotz/imaging/pixel-font";
import { STAR, downsample } from "@lotz/brand";
import { TOTAL_LOTS, formatCompact, formatInt, formatShare } from "@lotz/sdk";
import { Canvas } from "./canvas";

export const CARD_W = 1200;
export const CARD_H = 675;
const GRID = 10;
const MARGIN = 60;

export interface CardNumbers {
  lockedNow: bigint;
  supply: bigint;
  decimals: number;
  lotsSold: number;
  takeovers: number;
  /** YYYY-MM-DD shown in the corner. */
  date: string;
}

/** Cell size for the big figure: as large as fits the width, on the 10 px grid. */
export function bigCell(text: string, maxWidth = CARD_W - MARGIN * 2): number {
  const cols = text.length * (GLYPH_W + 1) - 1;
  return Math.max(GRID, Math.min(30, Math.floor(maxWidth / cols / GRID) * GRID));
}

export async function renderLockCard(n: CardNumbers): Promise<Buffer> {
  const c = new Canvas(CARD_W, CARD_H);
  c.grid(GRID, COLORS.paper, COLORS.grid);

  // the star and the site name, top left
  c.cells(downsample(STAR, 3, 0.2), MARGIN, 50, 4, COLORS.ink);
  c.cells(textCells("lotz.fun"), MARGIN + 130, 80, 6, COLORS.ink);

  const share = formatShare(n.lockedNow, n.supply);
  const cell = bigCell(share);
  const top = 200;
  c.cells(textCells(share), MARGIN, top, cell, COLORS.ink);
  const below = top + 7 * cell + 40;
  c.cells(textCells("of the supply is locked"), MARGIN, below, 8, COLORS.ink);

  // counts at the bottom, the date top right
  const tokens = formatCompact(n.lockedNow, n.decimals).toLowerCase();
  c.cells(textCells(`${tokens} tokens in the lock`), MARGIN, CARD_H - 110, 4, COLORS.mute);
  c.cells(
    textCells(`${formatInt(n.lotsSold)}/${formatInt(TOTAL_LOTS)} lots sold, ${formatInt(n.takeovers)} takeovers`),
    MARGIN,
    CARD_H - 70,
    4,
    COLORS.mute,
  );
  const date = textCells(n.date);
  c.cells(date, CARD_W - MARGIN - date[0]!.length * 4, 87, 4, COLORS.mute);

  return sharp(c.buf, { raw: { width: CARD_W, height: CARD_H, channels: 4 } }).png({ compressionLevel: 8 }).toBuffer();
}
