"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletReadyState, type WalletName } from "@solana/wallet-adapter-base";
import { Modal } from "./Modal";

const INSTALL = [
  { name: "Phantom", url: "https://phantom.com/download" },
  { name: "Solflare", url: "https://solflare.com/download" },
  { name: "Backpack", url: "https://backpack.app/download" },
];

const Ctx = createContext<{ open: () => void }>({ open: () => {} });
export const useWalletModal = () => useContext(Ctx);

export function WalletUiProvider({ children }: { children: ReactNode }) {
  const [isOpen, setOpen] = useState(false);
  const open = useCallback(() => setOpen(true), []);
  return (
    <Ctx.Provider value={{ open }}>
      {children}
      {isOpen && <WalletModal onClose={() => setOpen(false)} />}
    </Ctx.Provider>
  );
}

function WalletModal({ onClose }: { onClose: () => void }) {
  const { wallets, select, connect, wallet, connected, connecting } = useWallet();
  const [pending, setPending] = useState<WalletName | null>(null);
  const [error, setError] = useState<string | null>(null);
  const installed = wallets.filter((w) => w.readyState === WalletReadyState.Installed || w.readyState === WalletReadyState.Loadable);

  useEffect(() => {
    if (connected) onClose();
  }, [connected, onClose]);

  useEffect(() => {
    if (!pending || wallet?.adapter.name !== pending || connected || connecting) return;
    connect().catch((e: Error) => {
      setError(e?.message || "The wallet did not connect.");
      setPending(null);
    });
  }, [pending, wallet, connected, connecting, connect]);

  return (
    <Modal title="Connect wallet" onClose={onClose} width={360}>
      {installed.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {installed.map((w) => (
            <li key={w.adapter.name}>
              <button
                type="button"
                className="btn w-full justify-start"
                disabled={!!pending}
                onClick={() => {
                  setError(null);
                  setPending(w.adapter.name);
                  select(w.adapter.name);
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={w.adapter.icon} alt="" width={18} height={18} className="grayscale" />
                {w.adapter.name}
                {pending === w.adapter.name && <span className="ml-auto text-xs font-normal text-mute">Check your wallet</span>}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div>
          <p className="text-sm leading-relaxed">No Solana wallet found in this browser. Install one, then reload this page.</p>
          <ul className="mt-3 flex flex-col gap-2">
            {INSTALL.map((w) => (
              <li key={w.name}>
                <a className="link text-sm" href={w.url} target="_blank" rel="noopener noreferrer">
                  Get {w.name}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
      {error && <p className="mt-3 text-sm">{error}</p>}
    </Modal>
  );
}
