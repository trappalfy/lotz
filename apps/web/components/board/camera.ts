/** Board camera math: logical pixels (0..1000) <-> canvas CSS pixels. */
import { BOARD_PX, LOT_PX, type Rect } from "@lotz/sdk";

export interface Camera {
  /** CSS px per logical px. */
  s: number;
  /** Logical px at the canvas's top-left corner. */
  ox: number;
  oy: number;
}

export const MAX_ZOOM = 40;

export function fitCamera(size: number): Camera {
  return { s: size / BOARD_PX, ox: 0, oy: 0 };
}

export function zoomOf(cam: Camera, size: number): number {
  return cam.s / (size / BOARD_PX);
}

export function clampCamera(cam: Camera, size: number): Camera {
  const min = size / BOARD_PX;
  const s = Math.min(min * MAX_ZOOM, Math.max(min, cam.s));
  const view = size / s;
  return {
    s,
    ox: Math.min(BOARD_PX - view, Math.max(0, cam.ox)),
    oy: Math.min(BOARD_PX - view, Math.max(0, cam.oy)),
  };
}

/** Zooms by `factor` keeping the logical point under (sx, sy) in place. */
export function zoomAt(cam: Camera, size: number, sx: number, sy: number, factor: number): Camera {
  const lx = cam.ox + sx / cam.s;
  const ly = cam.oy + sy / cam.s;
  const s = cam.s * factor;
  return clampCamera({ s, ox: lx - sx / s, oy: ly - sy / s }, size);
}

export function screenToLot(cam: Camera, sx: number, sy: number): { lx: number; ly: number } {
  return { lx: Math.floor((cam.ox + sx / cam.s) / LOT_PX), ly: Math.floor((cam.oy + sy / cam.s) / LOT_PX) };
}

export function lotToScreen(cam: Camera, lx: number, ly: number): { x: number; y: number } {
  return { x: (lx * LOT_PX - cam.ox) * cam.s, y: (ly * LOT_PX - cam.oy) * cam.s };
}

/** The rectangle between an anchor lot and the current lot, at most `max` lots per side, inside the board. */
export function rectBetween(ax: number, ay: number, cx: number, cy: number, max: number): Rect {
  const clamp = (v: number) => Math.min(99, Math.max(0, v));
  cx = clamp(cx);
  cy = clamp(cy);
  const x0 = cx >= ax ? ax : Math.max(cx, ax - max + 1);
  const x1 = cx >= ax ? Math.min(cx, ax + max - 1) : ax;
  const y0 = cy >= ay ? ay : Math.max(cy, ay - max + 1);
  const y1 = cy >= ay ? Math.min(cy, ay + max - 1) : ay;
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
