/**
 * Eye anatomy from a cell matrix (brief §7.3): the white of the eye is every white cell that cannot be reached
 * from outside by a flood fill; the pupil is the black mass inside it (black cells between white-of-eye cells on
 * the same row). Moving the pupil shifts that mass by whole cells inside the eye's opening.
 */
import type { Cells } from "./index";

export interface EyeAnatomy {
  w: number;
  h: number;
  /** Cells that never change (outline, lashes). */
  fixed: Cells;
  /** The eye's opening: white of the eye plus the pupil. */
  opening: Cells;
  /** The pupil at rest. */
  pupil: Cells;
  /** Centre of the opening, in cells. */
  cx: number;
  cy: number;
}

export function analyzeEye(m: Cells): EyeAnatomy {
  const h = m.length;
  const w = Math.max(...m.map((r) => r.length));
  const at = (x: number, y: number) => !!m[y]?.[x];
  // flood fill the outside from the border through white cells
  const outside = Array.from({ length: h }, () => Array<boolean>(w).fill(false));
  const stack: [number, number][] = [];
  for (let x = 0; x < w; x++) stack.push([x, 0], [x, h - 1]);
  for (let y = 0; y < h; y++) stack.push([0, y], [w - 1, y]);
  while (stack.length) {
    const [x, y] = stack.pop()!;
    if (x < 0 || y < 0 || x >= w || y >= h || outside[y]![x] || at(x, y)) continue;
    outside[y]![x] = true;
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  const white = Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => !at(x, y) && !outside[y]![x]));
  const opening = Array.from({ length: h }, () => Array<boolean>(w).fill(false));
  const pupil = Array.from({ length: h }, () => Array<boolean>(w).fill(false));
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let y = 0; y < h; y++) {
    const xs = white[y]!.flatMap((v, x) => (v ? [x] : []));
    if (xs.length === 0) continue;
    const lo = Math.min(...xs);
    const hi = Math.max(...xs);
    for (let x = lo; x <= hi; x++) {
      opening[y]![x] = true;
      if (at(x, y)) pupil[y]![x] = true;
      sx += x;
      sy += y;
      n++;
    }
  }
  const fixed = Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => at(x, y) && !opening[y]![x]));
  return { w, h, fixed, opening, pupil, cx: n ? sx / n : w / 2, cy: n ? sy / n : h / 2 };
}

/** The eye with its pupil moved by (dx, dy) cells, clipped to the opening. */
export function eyeWithPupil(a: EyeAnatomy, dx: number, dy: number): Cells {
  const out = a.fixed.map((r) => r.slice());
  for (let y = 0; y < a.h; y++) {
    for (let x = 0; x < a.w; x++) {
      if (!a.pupil[y]![x]) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (a.opening[ny]?.[nx]) out[ny]![nx] = true;
    }
  }
  return out;
}
