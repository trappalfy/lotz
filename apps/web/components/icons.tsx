/** Pixel icons on a 7x7 or 9x9 grid (brief §6.3). `#` = filled cell. */
const ICONS = {
  copy: [".####..", ".#..#..", "####.#.", "#..#.#.", "#..###.", "#...#..", "#####.."],
  close: ["#.....#", ".#...#.", "..#.#..", "...#...", "..#.#..", ".#...#.", "#.....#"],
  external: ["..#####", "....###", "...#.##", "#.#...#", "#......", "#......", "#####.."],
  check: [".......", "......#", ".....#.", "#...#..", ".#.#...", "..#....", "......."],
  wallet: ["#######", "#.....#", "#..####", "#..#..#", "#..####", "#.....#", "#######"],
  arrowLeft: ["...#...", "..#....", ".#.....", "#######", ".#.....", "..#....", "...#..."],
  plus: ["...#...", "...#...", "...#...", "#######", "...#...", "...#...", "...#..."],
  minus: [".......", ".......", ".......", "#######", ".......", ".......", "......."],
  image: ["#########", "#.......#", "#.##....#", "#.##..#.#", "#....###.", "#...#####", "#..######", "#.#######", "#########"],
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 14, className = "" }: { name: IconName; size?: number; className?: string }) {
  const rows = ICONS[name];
  const n = rows.length;
  let d = "";
  rows.forEach((r, y) => [...r].forEach((c, x) => (c === "#" ? (d += `M${x} ${y}h1v1h-1z`) : null)));
  return (
    <svg aria-hidden width={size} height={size} viewBox={`0 0 ${n} ${n}`} shapeRendering="crispEdges" className={className}>
      <path d={d} fill="currentColor" />
    </svg>
  );
}
