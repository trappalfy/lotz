"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { formatTokens } from "@lotz/sdk";
import { useLotz } from "@/lib/client/lotz-context";
import { claimRefunds, closeAds } from "@/lib/client/owner";
import { explainError } from "@/lib/client/errors";
import type { MeResponse } from "@/lib/api-types";
import { useWalletModal } from "./WalletModal";
import { Footer } from "./sections/Footer";

const HIDDEN_WHY: Record<string, string> = {
  admin: "Hidden on this site by the moderators.",
  blocked_domain: "Hidden on this site: the link's domain is blocked.",
  hash_mismatch: "Hidden: the image file does not match the hash in the transaction.",
  mismatch: "Hidden: the image file does not match the hash in the transaction.",
  bad_image: "Hidden: the image could not be loaded.",
  error: "Hidden: the image could not be loaded.",
  pending: "The image is being checked.",
};

type Ad = MeResponse["ads"][number];

export function MePage() {
  const { connection, ixs, info, tick } = useLotz();
  const { publicKey, signTransaction } = useWallet();
  const { open } = useWalletModal();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const dec = info?.tokenDecimals ?? 6;

  const load = useCallback(async () => {
    if (!publicKey) return setMe(null);
    const r = await fetch(`/api/me/${publicKey.toBase58()}`, { cache: "no-store" });
    if (r.ok) setMe((await r.json()) as MeResponse);
  }, [publicKey]);

  useEffect(() => {
    void load();
  }, [load, tick]);

  const act = async (key: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(key);
    setMessage(null);
    try {
      await fn();
      setMessage(done);
      // the indexer picks the transaction up within a few seconds
      setTimeout(() => void load(), 1500);
      setTimeout(() => void load(), 5000);
    } catch (e) {
      setMessage(explainError(e));
    } finally {
      setBusy(null);
    }
  };

  const claim = (ads: Ad[]) =>
    act(
      ads.length === 1 ? `claim:${ads[0]!.id}` : "claim:all",
      () => claimRefunds(connection!, ixs!, publicKey!, signTransaction!, ads.map((a) => new PublicKey(a.address)), info?.lookupTable ?? null),
      "Claimed. The tokens are in your wallet.",
    );
  const close = (ads: Ad[]) =>
    act(
      ads.length === 1 ? `close:${ads[0]!.id}` : "close:all",
      () => closeAds(connection!, ixs!, publicKey!, signTransaction!, ads.map((a) => new PublicKey(a.address)), info?.lookupTable ?? null),
      "Closed. The rent is back in your wallet.",
    );

  const open_ = me?.ads.filter((a) => !a.closed) ?? [];
  const closed = me?.ads.filter((a) => a.closed) ?? [];
  const claimable = open_.filter((a) => BigInt(a.refundDue) > 0n);
  const closable = open_.filter((a) => a.canClose);
  const ready = !!connection && !!ixs && !!signTransaction;

  return (
    <>
      <main className="relative z-10 mx-auto min-h-[calc(100dvh-90px)] w-full max-w-[1030px] px-4 pb-24 pt-[110px] lg:pt-[90px]">
        <h1 className="text-[28px] font-bold tracking-tight">My lots</h1>
        {!publicKey ? (
          <div className="panel mt-6 max-w-[520px] p-5">
            <p className="text-[15px]">Connect the wallet you bought with to see your ads, lost lots and refunds.</p>
            <button type="button" className="btn btn-primary mt-4" onClick={open}>
              Connect wallet
            </button>
          </div>
        ) : !me ? (
          <p className="mt-6 text-mute">Loading…</p>
        ) : me.ads.length === 0 ? (
          <div className="panel mt-6 max-w-[520px] p-5">
            <p className="text-[15px]">This wallet has no ads yet.</p>
            <Link href="/?buy=1" className="btn btn-primary mt-4">
              Buy lots
            </Link>
          </div>
        ) : (
          <>
            <div className="mt-6 grid gap-6 sm:grid-cols-2">
              <div className="panel p-5">
                <div className="text-[13px] text-mute">Refunds to claim</div>
                <div className="num mt-1 text-[26px] font-medium">{formatTokens(BigInt(me.refundDueTotal), dec)}</div>
                <p className="mt-1 text-[13px] text-mute">Everything you paid for the lots that were taken.</p>
                <button type="button" className="btn btn-primary mt-4" disabled={!claimable.length || !ready || !!busy} onClick={() => claim(claimable)}>
                  {busy === "claim:all" ? "Claiming…" : claimable.length > 1 ? `Claim all (${claimable.length} ads)` : "Claim"}
                </button>
              </div>
              <div className="panel p-5">
                <div className="text-[13px] text-mute">Empty ads</div>
                <div className="num mt-1 text-[26px] font-medium">{closable.length}</div>
                <p className="mt-1 text-[13px] text-mute">Ads with no lots left and nothing to claim. Closing one returns its account rent in SOL.</p>
                <button type="button" className="btn mt-4" disabled={!closable.length || !ready || !!busy} onClick={() => close(closable)}>
                  {busy === "close:all" ? "Closing…" : closable.length > 1 ? `Close all (${closable.length})` : "Close"}
                </button>
              </div>
            </div>
            {message && (
              <p role="status" className="mt-4 border-2 border-ink bg-paper p-2 text-[14px]">
                {message}
              </p>
            )}

            <h2 className="mt-12 text-[20px] font-bold">Ads</h2>
            <ul className="mt-4 space-y-4">
              {open_.map((a) => (
                <li key={a.id} className="panel grid gap-4 p-4 sm:grid-cols-[120px_1fr_auto]">
                  <div className="flex h-[90px] w-[120px] items-center justify-center border border-grid bg-paper">
                    {a.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={a.image} alt="" className="max-h-full max-w-full" style={{ imageRendering: "pixelated" }} />
                    ) : (
                      <div className="hidden-pattern h-full w-full" />
                    )}
                  </div>
                  <div className="min-w-0 text-[14px]">
                    <div className="font-semibold break-words">{a.title || <span className="text-mute">no title</span>}</div>
                    <div className="num truncate text-[12px] text-mute">{a.domain ?? a.link}</div>
                    <div className="num mt-2 text-[12px]">
                      {a.w}×{a.h} at {a.x}, {a.y} · {a.lotsAlive} of {a.w * a.h} lots on the board
                      {a.lotsLost > 0 && ` · ${a.lotsLost} taken`}
                    </div>
                    <div className="num text-[12px] text-mute">paid {formatTokens(BigInt(a.paidTotal), dec)}</div>
                    {a.hiddenReason && <div className="mt-1 text-[12px]">{HIDDEN_WHY[a.hiddenReason] ?? "Hidden on this site."}</div>}
                  </div>
                  <div className="flex flex-col items-start gap-2 sm:items-end">
                    {BigInt(a.refundDue) > 0n && (
                      <>
                        <span className="num text-[13px]">{formatTokens(BigInt(a.refundDue), dec)} to claim</span>
                        <button type="button" className="btn btn-sm btn-primary" disabled={!ready || !!busy} onClick={() => claim([a])}>
                          {busy === `claim:${a.id}` ? "Claiming…" : "Claim"}
                        </button>
                      </>
                    )}
                    {a.canClose && (
                      <button type="button" className="btn btn-sm" disabled={!ready || !!busy} onClick={() => close([a])}>
                        {busy === `close:${a.id}` ? "Closing…" : "Close ad"}
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            {closed.length > 0 && <p className="mt-6 text-[13px] text-mute">{closed.length} closed {closed.length === 1 ? "ad" : "ads"} not shown.</p>}
          </>
        )}
      </main>
      <Footer />
    </>
  );
}
