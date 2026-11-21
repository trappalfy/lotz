"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Icon } from "./icons";

/** A panel with a black title bar (brief §6.3). Closes on Escape and on the backdrop. */
export function Modal({
  title,
  onClose,
  children,
  width = 420,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  width?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("[data-autofocus], button, a, input")?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-white/70 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className="panel w-full" style={{ maxWidth: width }}>
        <div className="flex h-9 items-center justify-between bg-ink pl-3 pr-1 text-paper">
          <span className="text-sm font-semibold">{title}</span>
          <button type="button" aria-label="Close" onClick={onClose} className="flex h-7 w-7 items-center justify-center hover:bg-white/15">
            <Icon name="close" size={12} />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}
