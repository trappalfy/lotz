"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Connection, PublicKey } from "@solana/web3.js";
import { LotzInstructions } from "@lotz/sdk";
import type { BoardResponse, DeploymentInfo, StatsResponse, StreamEvent, StreamStats } from "../api-types";
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
  /** Whether the live stream is connected; while it is not, the counters and the board are polled instead. */
  const streamUp = useRef(false);

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
      es.onopen = () => {
        streamUp.current = true;
      };
      es.onmessage = (m) => {
        streamUp.current = true;
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
        streamUp.current = false;
        // EventSource retries by itself; after a hard close, reopen (slowly: the poll below covers the gap).
        if (es?.readyState === EventSource.CLOSED && !closed) setTimeout(open, 15_000);
      };
    };
    open();
    return () => {
      closed = true;
      es?.close();
    };
  }, [refreshBoard, streamUrl]);

  // Without the live stream (its server unreachable), poll the counters every 10 s and reload the board when they
  // change, so purchases still show up within seconds.
  useEffect(() => {
    if (!info) return;
    let last = "";
    let alive = true;
    const t = setInterval(() => {
      if (streamUp.current || document.hidden) return;
      void fetch("/api/stats", { cache: "no-store" })
        .then((r) => (r.ok ? (r.json() as Promise<StatsResponse>) : null))
        .then((s) => {
          if (!s || !alive) return;
          setStats({
            lotsSold: s.lotsSold,
            takeovers: s.takeovers,
            totalLocked: s.totalLocked,
            totalReleased: s.totalReleased,
            freeLotPrice: s.freeLotPrice,
            paused: s.paused,
            supply: s.supply,
            tokenUsd: s.tokenUsd,
            priceAt: s.priceAt,
          });
          const key = `${s.lotsSold}/${s.takeovers}/${s.totalLocked}/${s.paused}`;
          if (last && key !== last) void refreshBoard();
          last = key;
        })
        .catch(() => {});
    }, 10_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [info, refreshBoard]);

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
