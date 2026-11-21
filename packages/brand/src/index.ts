/** The brand shapes as cell matrices (true = black cell), rows top to bottom. */
import cells from "../assets/lotz-cells.json" with { type: "json" };

export type Cells = boolean[][];

const parse = (rows: string[]): Cells => rows.map((r) => [...r].map((c) => c === "1"));

export const STAR: Cells = parse(cells.star);
export const EYES: [Cells, Cells, Cells] = [parse(cells.eyes[0]!), parse(cells.eyes[1]!), parse(cells.eyes[2]!)];

/** Downsamples a matrix by an integer factor: a cell is black if at least `threshold` of its block is black. */
export function downsample(m: Cells, factor: number, threshold = 0.35): Cells {
  const h = Math.ceil(m.length / factor);
  const w = Math.ceil((m[0]?.length ?? 0) / factor);
  const out: Cells = [];
  for (let y = 0; y < h; y++) {
    const row: boolean[] = [];
    for (let x = 0; x < w; x++) {
      let on = 0;
      let n = 0;
      for (let dy = 0; dy < factor; dy++) {
        for (let dx = 0; dx < factor; dx++) {
          const v = m[y * factor + dy]?.[x * factor + dx];
          if (v === undefined) continue;
          n++;
          if (v) on++;
        }
      }
      row.push(n > 0 && on / n >= threshold);
    }
    out.push(row);
  }
  return out;
}
export { analyzeEye, eyeWithPupil, type EyeAnatomy } from "./eyes";
