import { STAR, downsample } from "@lotz/brand";

const SMALL = downsample(STAR, 3, 0.2);
let d = "";
SMALL.forEach((row, y) => {
  let x = 0;
  while (x < row.length) {
    if (row[x]) {
      let run = 1;
      while (row[x + run]) run++;
      d += `M${x} ${y}h${run}v1h-${run}z`;
      x += run;
    } else x++;
  }
});

/** The pixel star from the logo. */
export function Star({ size = 24, className = "" }: { size?: number; className?: string }) {
  const w = SMALL[0]!.length;
  const h = SMALL.length;
  return (
    <svg aria-hidden width={(size * w) / h} height={size} viewBox={`0 0 ${w} ${h}`} shapeRendering="crispEdges" className={className}>
      <path d={d} fill="currentColor" />
    </svg>
  );
}
