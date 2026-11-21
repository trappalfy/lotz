"use client";

import { useEffect, useRef, useState } from "react";

export interface Crop {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Pick the part of the image that goes on the lots: a box with the rectangle's proportions that you drag, and a
 * slider for its size. Coordinates are in the image's own pixels (as the browser shows it, EXIF-rotated).
 */
export function ImageCropper({
  src,
  aspect,
  onChange,
}: {
  src: string;
  /** width / height of the rectangle */
  aspect: number;
  onChange: (c: Crop, natural: { w: number; h: number }) => void;
}) {
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [scale, setScale] = useState(1); // 0.1..1 of the largest box
  const [pos, setPos] = useState({ x: 0.5, y: 0.5 }); // center, as a fraction of the image
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  useEffect(() => {
    const img = new Image();
    img.onload = () => setNat({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = src;
    setScale(1);
    setPos({ x: 0.5, y: 0.5 });
  }, [src]);

  const crop: Crop | null = (() => {
    if (!nat) return null;
    const maxW = Math.min(nat.w, nat.h * aspect);
    const w = Math.max(1, Math.round(maxW * scale));
    const h = Math.max(1, Math.round(w / aspect));
    const left = Math.round(Math.min(nat.w - w, Math.max(0, pos.x * nat.w - w / 2)));
    const top = Math.round(Math.min(nat.h - h, Math.max(0, pos.y * nat.h - h / 2)));
    return { left, top, width: Math.min(w, nat.w), height: Math.min(h, nat.h) };
  })();

  useEffect(() => {
    if (crop && nat) onChange(crop, nat);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crop?.left, crop?.top, crop?.width, crop?.height]);

  if (!nat || !crop) return <div className="h-40 animate-pulse bg-[#f2f2f2]" />;

  const viewW = 300;
  const k = Math.min(viewW / nat.w, 220 / nat.h);
  const vw = nat.w * k;
  const vh = nat.h * k;

  const onDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    setPos({
      x: Math.min(1, Math.max(0, d.px + (e.clientX - d.x) / vw)),
      y: Math.min(1, Math.max(0, d.py + (e.clientY - d.y) / vh)),
    });
  };

  return (
    <div>
      <div className="relative mx-auto select-none overflow-hidden border-2 border-ink" style={{ width: vw + 4, height: vh + 4 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="" width={vw} height={vh} draggable={false} className="block" style={{ width: vw, height: vh }} />
        <div
          ref={box}
          role="slider"
          aria-label="Crop position"
          aria-valuetext={`${crop.left}, ${crop.top}`}
          tabIndex={0}
          onKeyDown={(e) => {
            const step = 0.02;
            if (e.key === "ArrowLeft") setPos((p) => ({ ...p, x: Math.max(0, p.x - step) }));
            if (e.key === "ArrowRight") setPos((p) => ({ ...p, x: Math.min(1, p.x + step) }));
            if (e.key === "ArrowUp") setPos((p) => ({ ...p, y: Math.max(0, p.y - step) }));
            if (e.key === "ArrowDown") setPos((p) => ({ ...p, y: Math.min(1, p.y + step) }));
          }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={() => (drag.current = null)}
          className="absolute cursor-move touch-none outline outline-2 outline-ink"
          style={{
            left: crop.left * k,
            top: crop.top * k,
            width: crop.width * k,
            height: crop.height * k,
            boxShadow: "0 0 0 9999px rgba(255,255,255,0.7)",
            border: "1px solid #fff",
          }}
        />
      </div>
      <label className="mt-3 flex items-center gap-3 text-[13px]">
        <span className="text-mute">Size</span>
        <input
          type="range"
          min={10}
          max={100}
          value={Math.round(scale * 100)}
          onChange={(e) => setScale(Number(e.target.value) / 100)}
          className="w-full accent-[var(--ink)]"
        />
      </label>
    </div>
  );
}
