"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Connection, PublicKey } from "@solana/web3.js";
import { LotzInstructions } from "@lotz/sdk";
import type { BoardResponse, DeploymentInfo, StreamEvent, StreamStats } from "../api-types";
import { BoardData } from "./board-data";
import { bus } from "./bus";

interface LotzState {
  info: DeploymentInfo | null;
  connection: Connection | null;
  ixs: LotzInstructions | null;
  board: BoardData | null;
  stats: StreamStats | null;
  /** Increments on every purchase from the stream (sections refetch on it). */
  tick: number;
  refreshBoard: () => Promise<void>;
}

const Ctx = createContext<LotzState | null>(null);

export function useLotz(): LotzState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useLotz outside LotzProvider");
  return v;
}

export function LotzProvider({ children }: { children: ReactNode }) {
  const [info, setInfo] = useState<DeploymentInfo | null>(null);
  const [board, setBoard] = useState<BoardData | null>(null);
  const [stats, setStats] = useState<StreamStats | null>(null);
  const [tick, setTick] = useState(0);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json() as Promise<DeploymentInfo>)
      .then(setInfo)
      .catch(() => {});
  }, []);

  const refreshBoard = useCallback(async () => {
    const r = await fetch("/api/board", { cache: "no-store" });
    if (r.ok) setBoard(new BoardData((await r.json()) as BoardResponse));
  }, []);

  useEffect(() => {
    void refreshBoard();
  }, [refreshBoard]);

  // live updates
  const streamUrl = info?.streamUrl ?? null;
  useEffect(() => {
    if (!streamUrl) return;
    let es: EventSource | null = null;
    let closed = false;
    const scheduleRefresh = () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => void refreshBoard(), 150);
    };
    const open = () => {
      es = new EventSource(streamUrl);
      es.onmessage = (m) => {
        let msg: StreamEvent;
        try {
          msg = JSON.parse(m.data) as StreamEvent;
        } catch {
          return;
        }
        if (msg.stats) setStats(msg.stats);
        // a new token price changes only the counters, not the board
        if (msg.type === "hello" || msg.type === "price") return;
        if (msg.type === "buy") {
          bus.emit("buy", msg.buy);
          setTick((t) => t + 1);
        }
        scheduleRefresh();
      };
      es.onerror = () => {
        // EventSource retries by itself; after a hard close, reopen.
        if (es?.readyState === EventSource.CLOSED && !closed) setTimeout(open, 3_000);
      };
    };
    open();
    return () => {
      closed = true;
      es?.close();
    };
  }, [refreshBoard, streamUrl]);

  const connection = useMemo(() => {
    if (!info) return null;
    const url = info.rpcUrl.startsWith("http") ? info.rpcUrl : new URL(info.rpcUrl, window.location.origin).toString();
    // No websocket through the proxy: confirmations are polled.
    return new Connection(url, { commitment: "confirmed", disableRetryOnRateLimit: false });
  }, [info]);

  const ixs = useMemo(() => {
    if (!info?.tokenMint || !info.tokenProgram || !info.treasury) return null;
    return new LotzInstructions({
      programId: new PublicKey(info.programId),
      mint: new PublicKey(info.tokenMint),
      tokenProgram: new PublicKey(info.tokenProgram),
      treasury: new PublicKey(info.treasury),
    });
  }, [info]);

  const value = useMemo(
    () => ({ info, connection, ixs, board, stats, tick, refreshBoard }),
    [info, connection, ixs, board, stats, tick, refreshBoard],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
