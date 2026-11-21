"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A heading laid out in filled grid cells (brief §6.2): the string is drawn in Inter Bold on an offscreen canvas,
 * binarized, and every dark pixel becomes a cell. The real text stays in the DOM for screen readers and search.
 * Used for at most two headings per page.
 */
export function PixelText({
  text,
  rows = 11,
  cell = 10,
  as: Tag = "h2",
  className = "",
}: {
  text: string;
  /** Glyph height in cells (cap height + descenders). */
  rows?: number;
  /** Cell size in CSS px at full width (shrinks to fit narrow screens). */
  cell?: number;
  as?: "h1" | "h2";
  className?: string;
}) {
  const [cells, setCells] = useState<{ w: number; h: number; on: Uint8Array } | null>(null);
  const [size, setSize] = useState(cell);
  const wrap = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [shift, setShift] = useState({ x: 0, y: 0 });

  useEffect(() => {
    let cancelled = false;
    const draw = () => {
      const fontPx = rows * 1.25;
      const c = document.createElement("canvas");
      const ctx = c.getContext("2d", { willReadFrequently: true })!;
      const family = getComputedStyle(document.body).getPropertyValue("--font-inter").trim() || "Inter";
      ctx.font = `700 ${fontPx}px ${family}, Inter, sans-serif`;
      const w = Math.ceil(ctx.measureText(text).width) + 2;
      const h = Math.ceil(fontPx * 1.15);
      c.width = w;
      c.height = h;
      ctx.font = `700 ${fontPx}px ${family}, Inter, sans-serif`;
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = "#000";
      ctx.fillText(text, 1, Math.round(fontPx * 0.92));
      const data = ctx.getImageData(0, 0, w, h).data;
      const on = new Uint8Array(w * h);
      let top = h;
      let bottom = 0;
      let left = w;
      let right = 0;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (data[(y * w + x) * 4 + 3]! > 110) {
            on[y * w + x] = 1;
            top = Math.min(top, y);
            bottom = Math.max(bottom, y);
            left = Math.min(left, x);
            right = Math.max(right, x);
          }
        }
      }
      if (top > bottom) return;
      const tw = right - left + 1;
      const th = bottom - top + 1;
      const trimmed = new Uint8Array(tw * th);
      for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) trimmed[y * tw + x] = on[(y + top) * w + x + left]!;
      if (!cancelled) setCells({ w: tw, h: th, on: trimmed });
    };
    void document.fonts.ready.then(draw);
    return () => {
      cancelled = true;
    };
  }, [text, rows]);

  // shrink the cell on narrow screens
  useEffect(() => {
    if (!cells || !wrap.current) return;
    const el = wrap.current;
    const fit = () => {
      const avail = el.parentElement?.clientWidth ?? el.clientWidth;
      setSize(Math.max(2, Math.min(cell, Math.floor(avail / cells.w))));
    };
    fit();
    const ro = new ResizeObserver(fit);
    if (el.parentElement) ro.observe(el.parentElement);
    return () => ro.disconnect();
  }, [cells, cell]);

  // sit on the page grid: move the drawing so its cells fall exactly into grid cells
  useEffect(() => {
    if (!cells || size !== 10) {
      setShift({ x: 0, y: 0 });
      return;
    }
    const snap = () => {
      const el = wrap.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const css = getComputedStyle(document.body);
      const gx = parseFloat(css.getPropertyValue("--grid-x")) || 0;
      const gy = parseFloat(css.getPropertyValue("--grid-y")) || 0;
      const mod = (v: number) => ((v % 10) + 10) % 10;
      const dx = mod(r.left + window.scrollX - gx);
      const dy = mod(r.top + window.scrollY - gy);
      setShift({ x: dx === 0 ? 0 : 10 - dx, y: dy === 0 ? 0 : 10 - dy });
    };
    snap();
    const t = setInterval(snap, 1000);
    window.addEventListener("resize", snap);
    return () => {
      clearInterval(t);
      window.removeEventListener("resize", snap);
    };
  }, [cells, size]);

  let path = "";
  if (cells) {
    for (let y = 0; y < cells.h; y++) {
      let x = 0;
      while (x < cells.w) {
        if (cells.on[y * cells.w + x]) {
          let run = 1;
          while (x + run < cells.w && cells.on[y * cells.w + x + run]) run++;
          path += `M${x} ${y}h${run}v1h-${run}z`;
          x += run;
        } else x++;
      }
    }
  }

  return (
    <div ref={wrap} className={className}>
      <Tag className={cells ? "sr-only" : "text-4xl font-bold tracking-tight"}>{text}</Tag>
      {cells && (
        <svg
          ref={svg}
          aria-hidden
          style={{ transform: `translate(${shift.x}px, ${shift.y}px)` }}
          width={cells.w * size}
          height={cells.h * size}
          viewBox={`0 0 ${cells.w} ${cells.h}`}
          shapeRendering="crispEdges"
          className="block"
        >
          <path d={path} fill="var(--ink)" />
        </svg>
      )}
    </div>
  );
}
