/** A drawing made of grid cells. `#` = ink, `o` = grid grey, `.` = empty. One cell = `cell` px (10 = the page grid). */
export function Cells({ rows, cell = 10, label, className = "" }: { rows: string[]; cell?: number; label?: string; className?: string }) {
  const w = Math.max(...rows.map((r) => r.length));
  let ink = "";
  let grey = "";
  rows.forEach((r, y) =>
    [...r].forEach((c, x) => {
      if (c === "#") ink += `M${x} ${y}h1v1h-1z`;
      else if (c === "o") grey += `M${x} ${y}h1v1h-1z`;
    }),
  );
  return (
    <svg
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      width={w * cell}
      height={rows.length * cell}
      viewBox={`0 0 ${w} ${rows.length}`}
      shapeRendering="crispEdges"
      className={className}
    >
      {grey && <path d={grey} fill="var(--grid-strong)" />}
      {ink && <path d={ink} fill="var(--ink)" />}
    </svg>
  );
}
