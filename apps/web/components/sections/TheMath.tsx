"use client";

import { useEffect, useState } from "react";
import { formatTokensExact, shortAddress, takeoverLadder } from "@lotz/sdk";
import { useLotz } from "@/lib/client/lotz-context";
import type { MathExample } from "@/lib/api-types";

const LADDER = takeoverLadder(6);
/** 1x, 1.5x, 2.25x, 3.38x, 5.06x, 7.59x, 11.39x (brief §2.6). */
const fmtX = (m: number) => `${parseFloat(m.toFixed(2))}x`;

export function TheMath() {
  const { tick, info } = useLotz();
  const [ex, setEx] = useState<MathExample | null | undefined>(undefined);
  const dec = info?.tokenDecimals ?? 6;
  useEffect(() => {
    fetch("/api/math")
      .then((r) => r.json() as Promise<MathExample | null>)
      .then(setEx)
      .catch(() => setEx(null));
  }, [tick]);

  return (
    <section id="math" aria-labelledby="math-title" className="scroll-mt-20">
      <h2 id="math-title" className="mb-6 text-[28px] font-bold tracking-tight">
        The math
      </h2>
      <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
        <div className="panel p-5">
          <p className="text-[17px] leading-relaxed">
            A lot bought for <span className="num">P</span> and taken over <span className="num">n</span> times costs{" "}
            <span className="num whitespace-nowrap">P × 1.5ⁿ</span>. The lock holds exactly that much for it.
          </p>
          <ol className="mt-5 space-y-[6px]" aria-label="Price of one lot after each takeover">
            {LADDER.map((m, n) => (
              <li key={n} className="flex items-center gap-3">
                <span className="num w-12 shrink-0 text-right text-[12px] text-mute">{n === 0 ? "bought" : `${n}×`}</span>
                <span className="block h-[10px] bg-ink" style={{ width: `${Math.max(1, Math.round(m * 2)) * 10}px` }} />
                <span className="num text-[12px]">{fmtX(m)}</span>
              </li>
            ))}
          </ol>
          <ul className="mt-6 space-y-2 border-t-2 border-ink pt-4 text-[14px] leading-relaxed">
            <li>
              <span className="font-semibold">Lose your lot, get every token back.</span>{" "}
              <span className="text-mute">The takeover price pays the previous owner exactly what they paid; the extra half goes to the lock.</span>
            </li>
            <li>
              <span className="font-semibold">The lock always holds the board&rsquo;s full price.</span>{" "}
              <span className="text-mute">Until unlocks start, the lock equals the sum of the current prices of every sold lot. Only the last owner of a lot has really paid for it.</span>
            </li>
          </ul>
        </div>
        <div className="panel p-5">
          <h3 className="text-[15px] font-semibold">The most taken lot</h3>
          {ex === undefined ? (
            <p className="mt-3 text-[14px] text-mute">Loading…</p>
          ) : ex === null ? (
            <p className="mt-3 text-[14px] leading-relaxed text-mute">
              No lot has been taken over yet. The first takeover will show up here with every price it went through.
            </p>
          ) : (
            <>
              <p className="mt-2 text-[14px] leading-relaxed">
                Lot <span className="num">({ex.x},{ex.y})</span> has been taken {ex.takeovers} {ex.takeovers === 1 ? "time" : "times"}. It now costs{" "}
                <span className="num font-semibold">{formatTokensExact(BigInt(ex.currentPrice), dec)}</span>, and the lock holds{" "}
                <span className="num font-semibold">{formatTokensExact(BigInt(ex.currentPrice), dec)}</span> for it.
              </p>
              <table className="num mt-4 w-full text-[12px]">
                <thead>
                  <tr className="text-left text-mute">
                    <th className="pb-1 font-normal">step</th>
                    <th className="pb-1 font-normal">owner</th>
                    <th className="pb-1 text-right font-normal">paid</th>
                    <th className="pb-1 text-right font-normal">got back</th>
                  </tr>
                </thead>
                <tbody>
                  {ex.steps.map((s, i) => {
                    const next = ex.steps[i + 1];
                    return (
                      <tr key={i} className="border-t border-grid">
                        <td className="py-1">{i === 0 ? "bought" : `taken ${i}`}</td>
                        <td className="py-1">{shortAddress(s.buyer)}</td>
                        <td className="py-1 text-right">{formatTokensExact(BigInt(s.price), dec)}</td>
                        <td className="py-1 text-right">{next ? formatTokensExact(BigInt(s.price), dec) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
