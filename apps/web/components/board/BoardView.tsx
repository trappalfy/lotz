"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { BOARD_PX, LOT_PX, MAX_RECT_LIMIT, formatTokens, shortAddress, type Rect } from "@lotz/sdk";
import { useLotz } from "@/lib/client/lotz-context";
import { boardGeometry, bus } from "@/lib/client/bus";
import type { BoardAd } from "@/lib/api-types";
import { ExitModal } from "../ExitModal";
import { useSelection } from "../selection";
import { Icon } from "../icons";
import {
  clampCamera,
  fitCamera,
  lotToScreen,
  rectBetween,
  screenToLot,
  zoomAt,
  zoomOf,
  type Camera,
} from "./camera";

const INK = "#0a0a0a";
const GRID = "#dedede";
const GRID_STRONG = "#c4c4c4";
const PAPER = "#ffffff";
const TILE_LOGICAL = 250; // a 4x tile covers 25 x 25 lots

/** Images by URL; each loads once and redraws the board when ready. */
function useImages(onLoad: () => void) {
  const cache = useRef(new Map<string, HTMLImageElement>());
  return useCallback(
    (url: string): HTMLImageElement | null => {
      let img = cache.current.get(url);
      if (!img) {
        img = new Image();
        img.decoding = "async";
        img.onload = onLoad;
        img.src = url;
        cache.current.set(url, img);
        if (cache.current.size > 120) {
          const first = cache.current.keys().next().value as string;
          cache.current.delete(first);
        }
      }
      return img.complete && img.naturalWidth > 0 ? img : null;
    },
    [onLoad],
  );
}

interface Hover {
  lx: number;
  ly: number;
  sx: number;
  sy: number;
}

export function BoardView() {
  const { board, info } = useLotz();
  const { publicKey } = useWallet();
  const { selecting, setSelecting, rect, setRect } = useSelection();
  const wrap = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const rulerTop = useRef<HTMLCanvasElement>(null);
  const rulerLeft = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState(1000);
  const [ruler, setRuler] = useState(30);
  const cam = useRef<Camera>(fitCamera(1000));
  const [zoom, setZoom] = useState(1);
  const [hover, setHover] = useState<Hover | null>(null);
  const [exit, setExit] = useState<BoardAd | null>(null);
  const dragRect = useRef<Rect | null>(null);
  const flashes = useRef<{ r: Rect; until: number }[]>([]);
  const raf = useRef(0);
  const drawRef = useRef<() => void>(() => {});
  const requestDraw = useCallback(() => {
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      drawRef.current();
    });
  }, []);
  const image = useImages(requestDraw);
  const prevImages = useRef<{ x1?: HTMLImageElement; x2?: HTMLImageElement; tiles: (HTMLImageElement | undefined)[] }>({ tiles: [] });

  // ------------------------------------------------------------ layout: size, rulers, grid alignment
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const fit = () => {
      const avail = el.parentElement!.clientWidth;
      const r = avail >= 700 ? 30 : 0;
      const s = Math.min(1000, Math.floor((avail - r) / 10) * 10);
      setRuler(r);
      setSize((prev) => {
        if (prev !== s) cam.current = clampCamera({ ...cam.current, s: (cam.current.s / prev) * s }, s);
        return s;
      });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el.parentElement!);
    return () => ro.disconnect();
  }, []);

  // the page grid starts where the board starts, so the board sits on it without a seam
  useEffect(() => {
    const align = () => {
      const f = frame.current;
      if (!f) return;
      const r = f.getBoundingClientRect();
      const x = Math.round(r.left + window.scrollX) % 100;
      const y = Math.round(r.top + window.scrollY) % 100;
      document.body.style.setProperty("--grid-x", `${x}px`);
      document.body.style.setProperty("--grid-y", `${y}px`);
    };
    align();
    const ro = new ResizeObserver(align);
    ro.observe(document.body);
    window.addEventListener("resize", align);
    // the panel opening next to the board can move it without resizing it
    const t = setTimeout(align, 50);
    return () => {
      clearTimeout(t);
      ro.disconnect();
      window.removeEventListener("resize", align);
    };
  }, [size, ruler, rect]);

  // where lots are on screen, for the background effects
  useEffect(() => {
    boardGeometry.lotToScreen = (lx, ly) => {
      const c = canvas.current;
      if (!c) return null;
      const r = c.getBoundingClientRect();
      const p = lotToScreen(cam.current, lx + 0.5, ly + 0.5);
      return {
        x: r.left + Math.min(r.width, Math.max(0, p.x)),
        y: r.top + Math.min(r.height, Math.max(0, p.y)),
      };
    };
    return () => {
      boardGeometry.lotToScreen = null;
    };
  }, []);

  // ------------------------------------------------------------ drawing
  drawRef.current = () => {
    const c = canvas.current;
    if (!c) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    if (c.width !== size * dpr) {
      c.width = size * dpr;
      c.height = size * dpr;
    }
    const ctx = c.getContext("2d")!;
    const { s, ox, oy } = cam.current;
    const z = zoomOf(cam.current, size);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, size, size);

    const view = size / s;
    const lotPx = LOT_PX * s;
    const line = (x0: number, y0: number, x1: number, y1: number) => {
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
    };
    const gridLines = (color: string, step: number) => {
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      const start = Math.floor(ox / step) * step;
      for (let gx = start; gx <= ox + view; gx += step) {
        const x = Math.round((gx - ox) * s) + 0.5;
        line(x, 0, x, size);
      }
      const startY = Math.floor(oy / step) * step;
      for (let gy = startY; gy <= oy + view; gy += step) {
        const y = Math.round((gy - oy) * s) + 0.5;
        line(0, y, size, y);
      }
      ctx.stroke();
    };
    const gridAbove = z >= 2;
    if (!gridAbove) {
      if (lotPx >= 5) gridLines(GRID, LOT_PX);
      gridLines(GRID_STRONG, 100);
    }

    // the board image: 1x, 2x, or 4x tiles depending on how many device pixels a logical pixel covers
    const density = s * dpr;
    const imgs = board?.images;
    ctx.imageSmoothingEnabled = density < 4;
    ctx.imageSmoothingQuality = "high";
    if (imgs) {
      const x1 = image(imgs.x1) ?? prevImages.current.x1;
      if (x1) prevImages.current.x1 = x1;
      let base: HTMLImageElement | undefined = x1;
      if (density > 1.25) {
        const x2 = image(imgs.x2) ?? prevImages.current.x2;
        if (x2) {
          prevImages.current.x2 = x2;
          base = x2;
        }
      }
      if (base) ctx.drawImage(base, (-ox * s), (-oy * s), BOARD_PX * s, BOARD_PX * s);
      if (density > 2.5) {
        imgs.tiles.forEach((url, i) => {
          const tx = (i % 4) * TILE_LOGICAL;
          const ty = Math.floor(i / 4) * TILE_LOGICAL;
          if (tx + TILE_LOGICAL < ox || ty + TILE_LOGICAL < oy || tx > ox + view || ty > oy + view) return;
          const t = image(url) ?? prevImages.current.tiles[i];
          if (!t) return;
          prevImages.current.tiles[i] = t;
          ctx.drawImage(t, (tx - ox) * s, (ty - oy) * s, TILE_LOGICAL * s, TILE_LOGICAL * s);
        });
      }
    }

    if (gridAbove) {
      gridLines("rgba(222,222,222,0.75)", LOT_PX);
      gridLines(GRID_STRONG, 100);
    }

    // `hidden` on hidden ads
    if (board) {
      ctx.font = `500 ${Math.max(10, Math.min(14, lotPx * 0.9))}px ${getComputedStyle(document.body).getPropertyValue("--font-plex-mono") || "monospace"}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (const ad of board.ads.values()) {
        if (!ad.hidden) continue;
        const p = lotToScreen(cam.current, ad.x, ad.y);
        const w = ad.w * lotPx;
        const h = ad.h * lotPx;
        if (w < 44 || h < 14 || p.x > size || p.y > size || p.x + w < 0 || p.y + h < 0) continue;
        ctx.fillStyle = "rgba(255,255,255,0.85)";
        const tw = ctx.measureText("hidden").width + 8;
        ctx.fillRect(p.x + w / 2 - tw / 2, p.y + h / 2 - 8, tw, 16);
        ctx.fillStyle = "#6b6b6b";
        ctx.fillText("hidden", p.x + w / 2, p.y + h / 2 + 0.5);
      }
    }

    const outline = (r: Rect, width: number, color = INK) => {
      const p = lotToScreen(cam.current, r.x, r.y);
      ctx.lineWidth = width;
      ctx.strokeStyle = PAPER;
      ctx.strokeRect(p.x - width / 2 - 1, p.y - width / 2 - 1, r.w * lotPx + width + 2, r.h * lotPx + width + 2);
      ctx.strokeStyle = color;
      ctx.strokeRect(p.x - width / 2, p.y - width / 2, r.w * lotPx + width, r.h * lotPx + width);
    };

    // hover
    if (hover && !dragRect.current && board) {
      const ad = board.adAt(hover.lx, hover.ly);
      if (ad) outline({ x: ad.x, y: ad.y, w: ad.w, h: ad.h }, 2);
      else outline({ x: hover.lx, y: hover.ly, w: 1, h: 1 }, 1);
    }

    // purchases arriving live: a short outline
    const now = performance.now();
    flashes.current = flashes.current.filter((f) => f.until > now);
    for (const f of flashes.current) outline(f.r, 3);
    if (flashes.current.length) requestDraw();

    // selection
    const sel = dragRect.current ?? rect;
    if (sel) {
      const p = lotToScreen(cam.current, sel.x, sel.y);
      ctx.fillStyle = "rgba(10,10,10,0.12)";
      ctx.fillRect(p.x, p.y, sel.w * lotPx, sel.h * lotPx);
      outline(sel, 2);
    }

    drawRulers();
  };

  const drawRulers = () => {
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const { s, ox, oy } = cam.current;
    const view = size / s;
    const font = getComputedStyle(document.body).getPropertyValue("--font-plex-mono") || "monospace";
    const step = s * 10 >= 8 ? 10 : 50;
    const labelStep = s * 100 >= 60 ? 100 : 200;
    const minor = s >= 4 ? 10 : step;
    for (const [el, horizontal] of [
      [rulerTop.current, true],
      [rulerLeft.current, false],
    ] as const) {
      if (!el || ruler === 0) continue;
      const w = horizontal ? size : ruler;
      const h = horizontal ? ruler : size;
      if (el.width !== w * dpr || el.height !== h * dpr) {
        el.width = w * dpr;
        el.height = h * dpr;
      }
      const ctx = el.getContext("2d")!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = PAPER;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = INK;
      ctx.font = `10px ${font}`;
      const origin = horizontal ? ox : oy;
      const start = Math.floor(origin / minor) * minor;
      for (let v = start; v <= origin + view + 0.01; v += minor) {
        const pos = Math.round((v - origin) * s);
        const len = v % 100 === 0 ? 10 : v % 50 === 0 ? 7 : 4;
        if (horizontal) ctx.fillRect(Math.min(pos, w - 1), h - len, 1, len);
        else ctx.fillRect(w - len, Math.min(pos, h - 1), len, 1);
        if (v % labelStep === 0) {
          const text = String(Math.round(v));
          if (horizontal) {
            ctx.textAlign = pos < 12 ? "left" : pos > w - 16 ? "right" : "center";
            ctx.textBaseline = "top";
            ctx.fillText(text, Math.min(Math.max(pos, 0), w), 3);
          } else {
            ctx.textAlign = "right";
            ctx.textBaseline = pos < 8 ? "top" : pos > h - 8 ? "bottom" : "middle";
            ctx.fillText(text, w - 12, Math.min(Math.max(pos, 0), h));
          }
        }
      }
    }
  };

  useEffect(() => {
    requestDraw();
  }, [board, size, hover, rect, ruler, requestDraw]);

  useEffect(
    () =>
      bus.on("buy", (b) => {
        flashes.current.push({ r: { x: b.x, y: b.y, w: b.w, h: b.h }, until: performance.now() + 1200 });
        requestDraw();
      }),
    [requestDraw],
  );

  const setCam = useCallback(
    (next: Camera) => {
      cam.current = clampCamera(next, size);
      setZoom(zoomOf(cam.current, size));
      requestDraw();
    },
    [size, requestDraw],
  );

  // ------------------------------------------------------------ input
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<
    | { kind: "pan"; x: number; y: number; cam: Camera; moved: boolean }
    | { kind: "pinch"; dist: number; mx: number; my: number; cam: Camera }
    | { kind: "select"; ax: number; ay: number }
    | null
  >(null);

  const local = (e: { clientX: number; clientY: number }) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const maxRect = board?.params?.maxRect ?? MAX_RECT_LIMIT;

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    canvas.current!.setPointerCapture(e.pointerId);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
      dragRect.current = null;
      gesture.current = { kind: "pinch", dist: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, cam: { ...cam.current } };
      return;
    }
    if (selecting || e.shiftKey) {
      const { lx, ly } = screenToLot(cam.current, p.x, p.y);
      gesture.current = { kind: "select", ax: lx, ay: ly };
      dragRect.current = { x: lx, y: ly, w: 1, h: 1 };
      setHover(null);
      requestDraw();
      return;
    }
    gesture.current = { kind: "pan", x: p.x, y: p.y, cam: { ...cam.current }, moved: false };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = local(e);
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, p);
    const g = gesture.current;
    if (g?.kind === "pinch" && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const s = g.cam.s * (dist / g.dist);
      const lx = g.cam.ox + g.mx / g.cam.s;
      const ly = g.cam.oy + g.my / g.cam.s;
      setCam({ s, ox: lx - mx / s, oy: ly - my / s });
      return;
    }
    if (g?.kind === "select") {
      const { lx, ly } = screenToLot(cam.current, p.x, p.y);
      dragRect.current = rectBetween(g.ax, g.ay, lx, ly, maxRect);
      requestDraw();
      return;
    }
    if (g?.kind === "pan" && pointers.current.size === 1) {
      const dx = p.x - g.x;
      const dy = p.y - g.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) g.moved = true;
      if (g.moved) setCam({ s: g.cam.s, ox: g.cam.ox - dx / g.cam.s, oy: g.cam.oy - dy / g.cam.s });
      return;
    }
    if (e.pointerType === "mouse") {
      const { lx, ly } = screenToLot(cam.current, p.x, p.y);
      if (lx < 0 || ly < 0 || lx > 99 || ly > 99) {
        setHover(null);
        return;
      }
      if (!hover || hover.lx !== lx || hover.ly !== ly) {
        bus.emit("hover", { lx, ly });
        bus.emit("look", { x: e.clientX, y: e.clientY });
      }
      setHover({ lx, ly, sx: p.x, sy: p.y });
    }
  };

  const endPointer = (e: React.PointerEvent<HTMLCanvasElement>, cancelled = false) => {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (g?.kind === "pinch") {
      if (pointers.current.size === 0) gesture.current = null;
      else {
        const [rest] = [...pointers.current.values()];
        gesture.current = { kind: "pan", x: rest!.x, y: rest!.y, cam: { ...cam.current }, moved: true };
      }
      return;
    }
    gesture.current = null;
    if (cancelled) {
      dragRect.current = null;
      requestDraw();
      return;
    }
    if (g?.kind === "select" && dragRect.current) {
      setRect(dragRect.current);
      setSelecting(true);
      dragRect.current = null;
      return;
    }
    if (g?.kind === "pan" && !g.moved && board) {
      const p = local(e);
      const { lx, ly } = screenToLot(cam.current, p.x, p.y);
      const ad = board.adAt(lx, ly);
      if (ad && !ad.hidden && ad.link && ad.domain) setExit(ad);
      else if (e.pointerType !== "mouse") setHover({ lx, ly, sx: p.x, sy: p.y });
    }
  };

  // wheel: zoom in to the cursor; zooming out stops at the full board, then the page scrolls
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const onWheel = (e: WheelEvent) => {
      const r = c.getBoundingClientRect();
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018));
      if (factor < 1 && zoomOf(cam.current, size) <= 1.0001) return;
      e.preventDefault();
      setCam(zoomAt(cam.current, size, e.clientX - r.left, e.clientY - r.top, factor));
    };
    c.addEventListener("wheel", onWheel, { passive: false });
    return () => c.removeEventListener("wheel", onWheel);
  }, [size, setCam]);

  // keyboard: Escape cancels a selection
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && (selecting || rect)) {
        setRect(null);
        setSelecting(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selecting, rect, setRect, setSelecting]);

  const zoomed = zoom > 1.001;
  const touchAction = selecting || zoomed ? "none" : "pan-y";

  // ------------------------------------------------------------ hover card
  let card: React.ReactNode = null;
  if (hover && board && !gesture.current) {
    const ad = board.adAt(hover.lx, hover.ly);
    const price = board.lotPrice(hover.lx, hover.ly);
    const dec = info?.tokenDecimals ?? 6;
    const left = hover.sx + 16 + 240 > size ? Math.max(4, hover.sx - 256) : hover.sx + 16;
    const top = hover.sy + 16 + 130 > size ? Math.max(4, hover.sy - 140) : hover.sy + 16;
    const mine = ad && publicKey && ad.owner === publicKey.toBase58();
    card = (
      <div className="panel pointer-events-none absolute z-10 w-60 p-3 text-[13px] leading-snug" style={{ left, top }}>
        {ad ? (
          <>
            <div className="font-semibold break-words">{ad.hidden ? <span className="text-mute">hidden</span> : ad.title || <span className="text-mute">no title</span>}</div>
            {ad.domain && <div className="num mt-0.5 truncate text-mute">{ad.domain}</div>}
            <dl className="num mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[12px]">
              <dt className="text-mute">owner</dt>
              <dd className="text-right">{mine ? "you" : shortAddress(ad.owner)}</dd>
              <dt className="text-mute">lots</dt>
              <dd className="text-right">
                {ad.lotsAlive} of {ad.w * ad.h}
              </dd>
              <dt className="text-mute">take this lot</dt>
              <dd className="text-right font-medium">{price !== null ? formatTokens(price, dec) : "—"}</dd>
            </dl>
          </>
        ) : (
          <>
            <div className="font-semibold">Free lot</div>
            <dl className="num mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[12px]">
              <dt className="text-mute">lot</dt>
              <dd className="text-right">
                {hover.lx}, {hover.ly}
              </dd>
              <dt className="text-mute">price</dt>
              <dd className="text-right font-medium">{price !== null ? formatTokens(price, dec) : "—"}</dd>
            </dl>
          </>
        )}
      </div>
    );
  }

  return (
    <div ref={wrap} id="board" className="relative" style={{ width: size + ruler, height: size + ruler }}>
      {ruler > 0 && (
        <>
          <canvas ref={rulerTop} aria-hidden className="absolute" style={{ left: ruler, top: 0, width: size, height: ruler }} />
          <canvas ref={rulerLeft} aria-hidden className="absolute" style={{ left: 0, top: ruler, width: ruler, height: size }} />
        </>
      )}
      <div
        ref={frame}
        className="absolute bg-paper"
        style={{ left: ruler, top: ruler, width: size, height: size, boxShadow: "0 0 0 2px var(--ink)" }}
      >
        <canvas
          ref={canvas}
          role="img"
          aria-label="The board: 10,000 lots. Hover a lot to see its ad and price."
          className={selecting ? "cursor-crosshair" : zoomed ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"}
          style={{ width: size, height: size, touchAction, display: "block" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={(e) => endPointer(e)}
          onPointerCancel={(e) => endPointer(e, true)}
          onPointerLeave={(e) => {
            if (e.pointerType === "mouse" && !gesture.current) {
              setHover(null);
              bus.emit("hover", null);
            }
          }}
          onDoubleClick={(e) => {
            const p = local(e);
            setCam(zoomAt(cam.current, size, p.x, p.y, 2));
          }}
        />
        {card}
        {selecting && !rect && (
          <div className="panel pointer-events-none absolute left-3 top-3 px-3 py-2 text-[13px]">
            Drag across the board to pick lots. Up to {maxRect} × {maxRect}.
          </div>
        )}
        <div className="absolute bottom-3 right-3 flex flex-col gap-2">
          <button type="button" className="btn btn-sm w-8 px-0" aria-label="Zoom in" onClick={() => setCam(zoomAt(cam.current, size, size / 2, size / 2, 2))}>
            <Icon name="plus" size={11} />
          </button>
          <button
            type="button"
            className="btn btn-sm w-8 px-0"
            aria-label="Zoom out"
            disabled={!zoomed}
            onClick={() => setCam(zoomAt(cam.current, size, size / 2, size / 2, 0.5))}
          >
            <Icon name="minus" size={11} />
          </button>
          {zoomed && (
            <button type="button" className="btn btn-sm num px-2 text-[11px]" onClick={() => setCam(fitCamera(size))}>
              {zoom.toFixed(zoom < 10 ? 1 : 0)}×
            </button>
          )}
        </div>
      </div>
      {exit && exit.link && exit.domain && <ExitModal link={exit.link} domain={exit.domain} onClose={() => setExit(null)} />}
    </div>
  );
}
