"use client";

import { useEffect, useState } from "react";
import { formatShare, formatTokens, shortAddress } from "@lotz/sdk";
import { useLotz } from "@/lib/client/lotz-context";
import { explorerAccount } from "@/lib/client/send";
import type { StatsResponse } from "@/lib/api-types";
import { PixelText } from "../PixelText";
import { Icon } from "../icons";

const date = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function Figure({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="panel p-4">
      <div className="text-[13px] text-mute">{label}</div>
      <div className="num mt-1 text-[24px] font-medium leading-tight">{value}</div>
      {note && <div className="num mt-1 text-[12px] text-mute">{note}</div>}
    </div>
  );
}

function AddressRow({ label, address, cluster }: { label: string; address: string | null; cluster: string }) {
  if (!address) return null;
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-grid py-2">
      <span className="text-mute">{label}</span>
      <a className="link num inline-flex items-center gap-1.5 break-all text-[13px]" href={explorerAccount(address, cluster)} target="_blank" rel="noopener noreferrer">
        <span className="hidden sm:inline">{address}</span>
        <span className="sm:hidden">{shortAddress(address, 6)}</span>
        <Icon name="external" size={9} />
      </a>
    </div>
  );
}

export function TheLock() {
  const { info, tick, stats: live } = useLotz();
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const dec = info?.tokenDecimals ?? 6;
  const cluster = info?.cluster ?? "localnet";
  useEffect(() => {
    fetch("/api/stats")
      .then((r) => r.json() as Promise<StatsResponse>)
      .then(setStats)
      .catch(() => {});
  }, [tick, live?.totalReleased]);

  const lockedNow = stats ? BigInt(stats.lockedNow) : 0n;
  const streamflowLocked = BigInt(stats?.streamflowLocked ?? "0");
  const epochStart = (k: number) => (stats?.launchTs ?? 0) + k * (stats?.epochLen ?? 604_800);

  return (
    <section id="lock" aria-labelledby="lock-title" className="scroll-mt-20">
      <PixelText text="The lock" rows={9} cell={10} className="mb-10" />
      <span id="lock-title" className="sr-only">The lock</span>
      <div className="max-w-[640px] space-y-1 text-[17px] leading-relaxed">
        <p>Every payment is locked for 365 days.</p>
        <p>Unlocks go to the treasury, week by week, one year after they came in.</p>
      </div>

      <div className="mt-8 grid gap-6 sm:grid-cols-3">
        <Figure
          label="In the lock now"
          value={stats ? formatTokens(lockedNow, dec) : "—"}
          note={stats?.supply ? `${formatShare(lockedNow, BigInt(stats.supply))} of the token supply` : undefined}
        />
        <Figure label="Released to the treasury" value={stats ? formatTokens(BigInt(stats.totalReleased), dec) : "—"} />
        <Figure
          label="Next unlock"
          value={stats?.nextUnlock ? date(stats.nextUnlock.at) : "—"}
          note={stats?.nextUnlock ? `${formatTokens(BigInt(stats.nextUnlock.amount), dec)} tokens, week ${stats.nextUnlock.epoch + 1}` : "Nothing locked yet"}
        />
      </div>

      {stats?.supply && BigInt(stats.supply) > 0n && (
        <p className="mt-6 max-w-[640px] text-[15px] leading-relaxed">
          Supply locked in total, with Streamflow:{" "}
          <span className="num font-semibold">{formatShare(lockedNow + streamflowLocked, BigInt(stats.supply))}</span>. The board{" "}
          <span className="num">{formatShare(lockedNow, BigInt(stats.supply))}</span>, Streamflow{" "}
          <span className="num">{formatShare(streamflowLocked, BigInt(stats.supply))}</span>
          {stats.streamflow.length > 0 ? ` in ${stats.streamflow.length} contract${stats.streamflow.length === 1 ? "" : "s"} nobody can cancel.` : "."}
        </p>
      )}
      {stats && stats.streamflow.length > 0 && (
        <div className="panel mt-4 max-w-[640px] p-5 text-[14px]">
          <h3 className="text-[15px] font-semibold">Locked on Streamflow</h3>
          <div className="mt-3">
            {stats.streamflow.slice(0, 20).map((c) => (
              <AddressRow
                key={c.address}
                label={`${formatTokens(BigInt(c.locked), dec)} until ${date(new Date(c.unlockAt * 1000).toISOString())}`}
                address={c.address}
                cluster={cluster}
              />
            ))}
          </div>
        </div>
      )}

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[1.2fr_1fr]">
        <div className="panel overflow-x-auto p-5">
          <h3 className="text-[15px] font-semibold">Weeks</h3>
          {stats && stats.epochs.length > 0 ? (
            <table className="num mt-3 w-full min-w-[440px] text-[12px]">
              <thead>
                <tr className="text-left text-mute">
                  <th className="pb-1 font-normal">week</th>
                  <th className="pb-1 font-normal">paid in</th>
                  <th className="pb-1 text-right font-normal">locked</th>
                  <th className="pb-1 text-right font-normal">unlocks</th>
                  <th className="pb-1 text-right font-normal">status</th>
                </tr>
              </thead>
              <tbody>
                {[...stats.epochs].reverse().map((e) => (
                  <tr key={e.epoch} className="border-t border-grid">
                    <td className="py-1">{e.epoch + 1}</td>
                    <td className="py-1">
                      {date(new Date(epochStart(e.epoch) * 1000).toISOString())} – {date(new Date((epochStart(e.epoch + 1) - 1) * 1000).toISOString())}
                    </td>
                    <td className="py-1 text-right">{formatTokens(BigInt(e.amount), dec)}</td>
                    <td className="py-1 text-right">{date(e.unlockAt)}</td>
                    <td className="py-1 text-right">{e.released ? "released" : "locked"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="mt-3 text-[14px] text-mute">Nothing locked yet. The first purchase opens week 1.</p>
          )}
        </div>
        <div className="panel p-5 text-[14px]">
          <h3 className="text-[15px] font-semibold">On-chain</h3>
          <div className="mt-3">
            <AddressRow label="Lock vault" address={info?.lockVault ?? null} cluster={cluster} />
            <AddressRow label="Program" address={info?.programId ?? null} cluster={cluster} />
            <AddressRow label="Treasury" address={info?.treasury ?? null} cluster={cluster} />
          </div>
          <div className="mt-3 border-t-2 border-ink pt-3">
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-mute">Program</span>
              <span className="num font-semibold">{info ? (info.upgradeAuthority ? "upgradeable" : "immutable") : "—"}</span>
            </div>
            <p className="mt-2 text-[13px] leading-relaxed text-mute">
              {info?.upgradeAuthority ? (
                <>
                  The upgrade authority <span className="num">{shortAddress(info.upgradeAuthority)}</span> can still replace the program, so
                  for now the lock relies on trust in the team. Once the authority is removed, nobody can change it.
                </>
              ) : info ? (
                "Nobody can change the program. The only way out of the lock is the weekly release to the treasury."
              ) : null}
            </p>
            {info?.sourceUrl && (
              <p className="mt-2 text-[13px] leading-relaxed text-mute">
                The program is open source.{" "}
                <a className="link" href={info.sourceUrl} target="_blank" rel="noopener noreferrer">
                  Read it before you buy.
                </a>
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
