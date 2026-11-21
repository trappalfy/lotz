"use client";

import { useMemo, type ReactNode } from "react";
import { WalletProvider } from "@solana/wallet-adapter-react";
import type { Adapter } from "@solana/wallet-adapter-base";
import { LotzProvider } from "@/lib/client/lotz-context";
import { WalletUiProvider } from "./WalletModal";
import { SelectionProvider } from "./selection";

/** Phantom, Solflare and Backpack register through the Wallet Standard, so no adapter list is needed. */
export function Providers({ children }: { children: ReactNode }) {
  const wallets = useMemo<Adapter[]>(() => [], []);
  return (
    <WalletProvider wallets={wallets} autoConnect>
      <WalletUiProvider>
        <LotzProvider>
          <SelectionProvider>{children}</SelectionProvider>
        </LotzProvider>
      </WalletUiProvider>
    </WalletProvider>
  );
}
