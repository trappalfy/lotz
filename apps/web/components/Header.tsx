"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { TOTAL_LOTS, formatCompact, formatInt, formatTokens, shortAddress } from "@lotz/sdk";
import { useLotz } from "@/lib/client/lotz-context";
import type { StatsResponse, StreamStats } from "@/lib/api-types";
import { useWalletModal } from "./WalletModal";
import { useSelection } from "./selection";
import { Star } from "./Logo";
import { Icon } from "./icons";

function Counter({ label, value }: { label: string; value: string }) {
  return (
    <span className="whitespace-nowrap">
      <span className="text-mute">{label}</span> <span className="font-medium">{value}</span>
    </span>
  );
}

export function Counters({ className = "" }: { className?: string }) {
  const { stats, info } = useLotz();
  const [initial, setInitial] = useState<StreamStats | null>(null);
  useEffect(() => {
    if (stats) return;
    fetch("/api/stats")
      .then((r) => r.json() as Promise<StatsResponse>)
      .then((s) => setInitial(s))
      .catch(() => {});
  }, [stats]);
  const s = stats ?? initial;
  const dec = info?.tokenDecimals ?? 6;
  return (
    <div className={`num flex items-center gap-5 text-[12px] ${className}`} aria-live="polite">
      <Counter label="LOTS" value={s ? `${formatInt(s.lotsSold)} / ${formatInt(TOTAL_LOTS)}` : "—"} />
      <Counter label="FREE LOT" value={s ? formatTokens(BigInt(s.freeLotPrice), dec) : "—"} />
      <Counter label="LOCKED" value={s ? formatCompact(BigInt(s.totalLocked) - BigInt(s.totalReleased), dec) : "—"} />
      <Counter label="TAKEOVERS" value={s ? formatInt(s.takeovers) : "—"} />
    </div>
  );
}

function CaButton() {
  const { info } = useLotz();
  const [copied, setCopied] = useState(false);
  if (!info?.tokenMint) return null;
  return (
    <button
      type="button"
      className="btn btn-sm num"
      title={info.tokenMint}
      onClick={() => {
        void navigator.clipboard.writeText(info.tokenMint!).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      <Icon name={copied ? "check" : "copy"} size={12} />
      {copied ? "Copied" : "CA"}
    </button>
  );
}

function WalletButton() {
  const { publicKey, disconnect, connecting } = useWallet();
  const { open } = useWalletModal();
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setMenu(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [menu]);
  if (!publicKey) {
    return (
      <button type="button" className="btn btn-sm" onClick={open} disabled={connecting}>
        {connecting ? "Connecting…" : "Connect wallet"}
      </button>
    );
  }
  return (
    <div ref={ref} className="relative">
      <button type="button" className="btn btn-sm num" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
        {shortAddress(publicKey.toBase58())}
      </button>
      {menu && (
        <div className="panel absolute right-0 top-10 z-50 flex w-44 flex-col py-1 text-sm">
          <Link href="/me" className="px-3 py-2 hover:bg-[#f2f2f2]" onClick={() => setMenu(false)}>
            My lots
          </Link>
          <button
            type="button"
            className="px-3 py-2 text-left hover:bg-[#f2f2f2]"
            onClick={() => {
              setMenu(false);
              void disconnect();
            }}
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}

export function Header() {
  const { setSelecting, selecting } = useSelection();
  const path = usePathname();
  const router = useRouter();
  return (
    <header className="fixed inset-x-0 top-0 z-40 border-b-2 border-ink bg-paper">
      <div className="flex h-[48px] items-center gap-4 px-4">
        <Link href="/" className="flex items-center gap-2" aria-label="Lotz home">
          <Star size={26} />
          <span className="text-[22px] font-bold leading-none tracking-tight">Lotz</span>
        </Link>
        <Counters className="mx-auto hidden lg:flex" />
        <div className="ml-auto flex items-center gap-3 lg:ml-0">
          <span className="hidden sm:inline-flex">
            <CaButton />
          </span>
          <WalletButton />
          <button
            type="button"
            className="btn btn-sm btn-primary"
            aria-pressed={selecting}
            onClick={() => {
              if (path !== "/") {
                router.push("/?buy=1");
                return;
              }
              setSelecting(!selecting);
              const top = document.getElementById("board")?.getBoundingClientRect().top ?? 0;
              if (!selecting && (top < 0 || top > window.innerHeight * 0.6)) {
                document.getElementById("board")?.scrollIntoView({ behavior: "smooth", block: "start" });
              }
            }}
          >
            {selecting ? "Cancel" : "Buy lots"}
          </button>
        </div>
      </div>
      <div className="flex h-8 items-center overflow-x-auto border-t border-grid px-4 lg:hidden">
        <Counters />
      </div>
    </header>
  );
}
