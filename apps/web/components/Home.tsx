"use client";

import { useEffect } from "react";
import { BoardView } from "./board/BoardView";
import { BuyPanel } from "./BuyPanel";
import { useSelection } from "./selection";
import { HowItWorks } from "./sections/HowItWorks";
import { TheMath } from "./sections/TheMath";
import { TheLock } from "./sections/TheLock";
import { Activity } from "./sections/Activity";
import { Faq } from "./sections/Faq";
import { Footer } from "./sections/Footer";

export function Home() {
  const { rect, setSelecting } = useSelection();

  // /?buy=1 (the header's "Buy lots" on other pages) starts a selection
  useEffect(() => {
    const u = new URL(window.location.href);
    if (u.searchParams.get("buy") === "1") {
      setSelecting(true);
      u.searchParams.delete("buy");
      window.history.replaceState(null, "", u.pathname + u.search);
    }
  }, [setSelecting]);

  return (
    <>
      <main className="relative z-10 pb-24 pt-[110px] lg:pt-[80px]">
        <h1 className="sr-only">Lotz — 1,000,000 pixels on Solana</h1>
        <div className="mx-auto flex w-full max-w-[1460px] items-start justify-center gap-6 px-4">
          <div className="min-w-0 max-w-[1030px] flex-1">
            <p className="mb-3 max-w-[640px] text-[15px] font-medium md:pl-[30px]">10,000 lots on one board. Yours until someone pays 1.5x for it.</p>
            <BoardView />
            <p className="mt-3 text-[12px] text-mute md:pl-[30px]">
              <span className="pointer-coarse:hidden">Scroll to zoom, drag to move. Shift+drag, or press Buy lots, to pick lots.</span>
              <span className="hidden pointer-coarse:inline">Pinch to zoom. Press Buy lots, then drag across the board to pick lots.</span>
            </p>
          </div>
          {rect && <BuyPanel />}
        </div>

        <div className="mx-auto mt-24 w-full max-w-[1030px] space-y-24 px-4 md:pl-[46px]">
          <HowItWorks />
          <TheMath />
          <TheLock />
          <Activity />
          <Faq />
        </div>
      </main>
      <Footer />
    </>
  );
}
