"use client";

import { useEffect, useState } from "react";
import { formatTokens, shortAddress } from "@lotz/sdk";
import { useLotz } from "@/lib/client/lotz-context";
import { explorerTx } from "@/lib/client/send";
import type { ActivityItem } from "@/lib/api-types";
import { Icon } from "../icons";

function ago(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}

export function Activity() {
  const { tick, info } = useLotz();
  const [items, setItems] = useState<ActivityItem[] | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [more, setMore] = useState(true);
  const dec = info?.tokenDecimals ?? 6;

  useEffect(() => {
    fetch("/api/activity?limit=20")
      .then((r) => r.json() as Promise<ActivityItem[]>)
      .then((list) => {
        setItems(list);
        setMore(list.length === 20);
      })
      .catch(() => setItems([]));
  }, [tick]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);

  const loadMore = async () => {
    if (!items?.length) return;
    const r = await fetch(`/api/activity?limit=20&before=${items[items.length - 1]!.id}`);
    const list = (await r.json()) as ActivityItem[];
    setItems([...items, ...list]);
    setMore(list.length === 20);
  };

  return (
    <section id="activity" aria-labelledby="activity-title" className="scroll-mt-20">
      <h2 id="activity-title" className="mb-6 text-[28px] font-bold tracking-tight">
        Activity
      </h2>
      <div className="panel">
        {items === null ? (
          <p className="p-5 text-[14px] text-mute">Loading…</p>
        ) : items.length === 0 ? (
          <p className="p-5 text-[14px] text-mute">No purchases yet. The first one will appear here the moment it lands.</p>
        ) : (
          <ul>
            {items.map((a) => (
              <li key={a.id} className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 border-b border-grid px-5 py-3 last:border-b-0 sm:grid-cols-[110px_1fr_auto_auto] sm:items-baseline">
                <span className="num text-[12px] text-mute">{ago(a.at, now)}</span>
                <span className="col-span-2 row-start-2 min-w-0 text-[14px] sm:col-span-1 sm:row-start-auto">
                  <span className="font-semibold">{a.takenLots > 0 ? (a.freeLots > 0 ? "Bought and took" : "Took") : "Bought"}</span>{" "}
                  <span className="num">
                    {a.w}×{a.h}
                  </span>{" "}
                  at{" "}
                  <span className="num">
                    {a.x}, {a.y}
                  </span>
                  {a.takenLots > 0 && <span className="text-mute"> · {a.takenLots} taken</span>}
                  <span className="block truncate text-[13px] text-mute">
                    {a.hidden ? "hidden" : [a.title, a.domain].filter(Boolean).join(" · ") || "no title"} · {shortAddress(a.buyer)}
                  </span>
                </span>
                <span className="num text-right text-[13px]">{formatTokens(BigInt(a.paidTotal), dec)}</span>
                <a
                  className="hidden items-center text-mute hover:text-ink sm:inline-flex"
                  href={explorerTx(a.signature, info?.cluster ?? "localnet")}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="View transaction"
                >
                  <Icon name="external" size={10} />
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
      {more && items && items.length > 0 && (
        <button type="button" className="btn btn-sm mt-4" onClick={loadMore}>
          Show older
        </button>
      )}
    </section>
  );
}
