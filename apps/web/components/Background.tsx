"use client";

import { useEffect, useRef } from "react";
import { EYES, STAR, analyzeEye, downsample, eyeWithPupil, type Cells, type EyeAnatomy } from "@lotz/brand";
import { bus, boardGeometry } from "@/lib/client/bus";

/**
 * The background (brief §7): the board is a piece of an endless grid, and the grid reacts.
 * - Every purchase from the stream flashes the logo star from its lot; five rays run cell by cell across the
 *   grid and go out cell by cell (~1.2 s). Takeovers flash bigger, with longer, thicker rays.
 * - Three eyes stand in the margins on wide screens; pupils move 1-2 cells towards the cursor, the hovered lot,
 *   or the latest flash.
 * - At rest, now and then one or two grid cells blink black.
 * Everything is drawn on one canvas under the content, in cells of the page grid. `prefers-reduced-motion`
 * turns off flashes and blinking and keeps the eyes still.
 */

const CELL = 10;
const INK = "#0a0a0a";

/** Star centre and ray tips in the original 58 x 68 star matrix. */
const STAR_CENTER = { x: 17, y: 25 };
const STAR_TIPS = [
  { x: 0, y: 0 },
  { x: 33, y: 2 },
  { x: 57, y: 32 },
  { x: 37, y: 67 },
  { x: 0, y: 24 },
];

interface LitCell {
  /** grid cell (document grid coordinates) */
  gx: number;
  gy: number;
  on: number;
  off: number;
}

interface Flash {
  cells: LitCell[];
  end: number;
  at: { x: number; y: number };
}

const STARS = { small: downsample(STAR, 5, 0.2), big: downsample(STAR, 3, 0.2) };

function cellsOf(m: Cells): [number, number][] {
  const out: [number, number][] = [];
  m.forEach((r, y) => r.forEach((v, x) => v && out.push([x, y])));
  return out;
}

export function Background() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let grid = { x: 0, y: 0 };
    const readGrid = () => {
      const css = getComputedStyle(document.body);
      grid = { x: parseFloat(css.getPropertyValue("--grid-x")) || 0, y: parseFloat(css.getPropertyValue("--grid-y")) || 0 };
    };
    readGrid();

    let w = 0;
    let h = 0;
    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      readGrid();
      layoutEyes();
      request();
    };

    // screen <-> grid cells (the grid lives in document coordinates)
    const toCell = (sx: number, sy: number) => ({
      gx: Math.floor((sx + window.scrollX - grid.x) / CELL),
      gy: Math.floor((sy + window.scrollY - grid.y) / CELL),
    });
    const cellToScreen = (gx: number, gy: number) => ({
      x: gx * CELL + grid.x - window.scrollX,
      y: gy * CELL + grid.y - window.scrollY,
    });
    const fillCell = (gx: number, gy: number) => {
      const p = cellToScreen(gx, gy);
      if (p.x < -CELL || p.y < -CELL || p.x > w || p.y > h) return;
      ctx.fillRect(p.x + 1, p.y + 1, CELL - 1, CELL - 1);
    };

    // ------------------------------------------------------------ eyes
    const anatomies: EyeAnatomy[] = EYES.map(analyzeEye);
    let eyes: { a: EyeAnatomy; gx: number; gy: number; dx: number; dy: number }[] = [];
    let look: { x: number; y: number } | null = null;

    function layoutEyes() {
      eyes = [];
      const board = document.getElementById("board");
      if (!board || w < 1500) return;
      const r = board.getBoundingClientRect();
      const top = r.top + window.scrollY;
      const left = r.left + window.scrollX;
      const right = left + r.width;
      const marginL = left;
      const marginR = document.documentElement.clientWidth - right;
      // two on the left, one on the right, at different heights; never in a row
      const place = (a: EyeAnatomy, side: "l" | "r", frac: number) => {
        const widthPx = a.w * CELL;
        const room = side === "l" ? marginL : marginR;
        if (room < widthPx + 20) return;
        const gap = Math.max(10, Math.min(80, (room - widthPx) / 2));
        const x = side === "l" ? left - widthPx - gap : right + gap;
        const y = top + r.height * frac;
        eyes.push({ a, gx: Math.round((x - grid.x) / CELL), gy: Math.round((y - grid.y) / CELL), dx: 0, dy: 0 });
      };
      place(anatomies[0]!, "l", 0.12);
      place(anatomies[1]!, "r", 0.38);
      place(anatomies[2]!, "l", 0.68);
    }

    function aimEyes(): boolean {
      let changed = false;
      for (const e of eyes) {
        let dx = 0;
        let dy = 0;
        if (look && !reduced.matches) {
          const c = cellToScreen(e.gx + e.a.cx, e.gy + e.a.cy);
          const vx = look.x - c.x;
          const vy = look.y - c.y;
          const d = Math.hypot(vx, vy) || 1;
          const reach = Math.min(2, d / 120);
          dx = Math.round((vx / d) * reach);
          dy = Math.max(-1, Math.min(1, Math.round((vy / d) * reach * 0.6)));
        }
        if (dx !== e.dx || dy !== e.dy) {
          e.dx = dx;
          e.dy = dy;
          changed = true;
        }
      }
      return changed;
    }

    // ------------------------------------------------------------ flashes
    let flashes: Flash[] = [];

    function flash(lx: number, ly: number, big: boolean) {
      if (reduced.matches || !boardGeometry.lotToScreen) return;
      const p = boardGeometry.lotToScreen(lx, ly);
      if (!p) return;
      const now = performance.now();
      const origin = toCell(p.x, p.y);
      const factor = big ? 3 : 5;
      const star = big ? STARS.big : STARS.small;
      const cx = Math.round(STAR_CENTER.x / factor);
      const cy = Math.round(STAR_CENTER.y / factor);
      const cells: LitCell[] = [];
      for (const [x, y] of cellsOf(star)) {
        cells.push({ gx: origin.gx + x - cx, gy: origin.gy + y - cy, on: now, off: now + 250 + Math.random() * 650 });
      }
      // rays: from each tip of the star, outward across the grid
      const screenCells = Math.ceil((Math.hypot(w, h) + Math.max(0, -p.y, p.y - h)) / CELL);
      const rayLen = big ? screenCells : Math.round(screenCells * 0.45);
      const travel = big ? 700 : 520;
      for (const tip of STAR_TIPS) {
        const vx = tip.x - STAR_CENTER.x;
        const vy = tip.y - STAR_CENTER.y;
        const len = Math.hypot(vx, vy);
        const ux = vx / len;
        const uy = vy / len;
        const sx = origin.gx + (tip.x - STAR_CENTER.x) / factor;
        const sy = origin.gy + (tip.y - STAR_CENTER.y) / factor;
        let last = "";
        let entered = false;
        for (let i = 1; i <= rayLen; i++) {
          const gx = Math.round(sx + ux * i);
          const gy = Math.round(sy + uy * i);
          const key = `${gx},${gy}`;
          if (key === last) continue;
          last = key;
          const s = cellToScreen(gx, gy);
          const visible = s.x >= -CELL && s.y >= -CELL && s.x <= w && s.y <= h;
          // a ray may start off screen (a lot scrolled away) and come in; it ends once it has left
          if (!visible) {
            if (entered) break;
            continue;
          }
          entered = true;
          const on = now + (i / rayLen) * travel;
          const off = on + (big ? 260 : 200);
          cells.push({ gx, gy, on, off });
          if (big) cells.push({ gx: gx + (Math.abs(uy) > Math.abs(ux) ? 1 : 0), gy: gy + (Math.abs(uy) > Math.abs(ux) ? 0 : 1), on, off });
        }
      }
      flashes.push({ cells, end: Math.max(...cells.map((c) => c.off)), at: p });
      look = p;
      aimEyes();
      request();
    }

    // ------------------------------------------------------------ idle blinking
    let blink: { gx: number; gy: number; off: number }[] = [];
    let nextBlink = performance.now() + 3000;

    // ------------------------------------------------------------ frame loop (runs only while something moves)
    let raf = 0;
    function request() {
      if (!raf) raf = requestAnimationFrame(frame);
    }

    function frame(now: number) {
      raf = 0;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = INK;

      for (const e of eyes) {
        const m = eyeWithPupil(e.a, e.dx, e.dy);
        m.forEach((row, y) => row.forEach((v, x) => v && fillCell(e.gx + x, e.gy + y)));
      }

      flashes = flashes.filter((f) => f.end > now);
      for (const f of flashes) for (const c of f.cells) if (now >= c.on && now < c.off) fillCell(c.gx, c.gy);

      if (!reduced.matches) {
        if (now >= nextBlink) {
          const n = Math.random() < 0.3 ? 2 : 1;
          for (let i = 0; i < n; i++) {
            const c = toCell(Math.random() * w, 60 + Math.random() * (h - 60));
            blink.push({ gx: c.gx, gy: c.gy, off: now + 140 + Math.random() * 120 });
          }
          nextBlink = now + 2500 + Math.random() * 4000;
        }
        blink = blink.filter((b) => b.off > now);
        for (const b of blink) fillCell(b.gx, b.gy);
      }

      // keep going while anything is lit or a blink is due soon
      if (flashes.length || blink.length) request();
      else if (!reduced.matches) setTimeout(request, Math.max(16, nextBlink - performance.now()));
    }

    // ------------------------------------------------------------ inputs
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      look = { x: e.clientX, y: e.clientY };
      if (aimEyes()) request();
    };
    const onScroll = () => request();
    const offBuy = bus.on("buy", (b) => flash(b.x + Math.floor(b.w / 2), b.y + Math.floor(b.h / 2), b.takenLots > 0));
    const offLook = bus.on("look", (p) => {
      look = p;
      if (aimEyes()) request();
    });
    // the grid origin and the board position settle after layout
    const relayout = setInterval(() => {
      const before = `${grid.x},${grid.y}`;
      readGrid();
      layoutEyes();
      if (before !== `${grid.x},${grid.y}`) request();
    }, 1000);

    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pointermove", onMove, { passive: true });
    reduced.addEventListener("change", request);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(relayout);
      offBuy();
      offLook();
      window.removeEventListener("resize", resize);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pointermove", onMove);
      reduced.removeEventListener("change", request);
    };
  }, []);

  return <canvas ref={ref} aria-hidden className="pointer-events-none fixed inset-0 z-0" />;
}
