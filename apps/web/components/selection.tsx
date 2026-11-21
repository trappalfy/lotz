"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { Rect } from "@lotz/sdk";

/** The purchase selection, shared by the header's "Buy lots", the board and the buy panel. */
interface SelectionState {
  selecting: boolean;
  setSelecting: (v: boolean) => void;
  rect: Rect | null;
  setRect: (r: Rect | null) => void;
}

const Ctx = createContext<SelectionState | null>(null);

export function SelectionProvider({ children }: { children: ReactNode }) {
  const [selecting, setSelecting] = useState(false);
  const [rect, setRect] = useState<Rect | null>(null);
  const value = useMemo(() => ({ selecting, setSelecting, rect, setRect }), [selecting, rect]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSelection(): SelectionState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSelection outside SelectionProvider");
  return v;
}
