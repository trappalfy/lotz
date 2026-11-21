"use client";

import { useState } from "react";
import { useLotz } from "@/lib/client/lotz-context";
import { Star } from "../Logo";

export function Footer() {
  const { info } = useLotz();
  const [copied, setCopied] = useState(false);
  return (
    <footer className="border-t-2 border-ink bg-paper">
      <div className="mx-auto flex max-w-[1030px] flex-wrap items-center gap-x-6 gap-y-3 px-4 py-6 text-[14px]">
        <span className="flex items-center gap-2 font-bold">
          <Star size={18} /> lotz
        </span>
        <span className="text-mute">10,000 lots on one board.</span>
        <nav className="ml-auto flex flex-wrap items-center gap-x-5 gap-y-2" aria-label="Elsewhere">
          {info?.xUrl && (
            <a className="link" href={info.xUrl} target="_blank" rel="noopener noreferrer">
              X
            </a>
          )}
          {info?.tokenMint && (
            <button
              type="button"
              className="link num text-[13px]"
              title="Copy the token address"
              onClick={() => void navigator.clipboard.writeText(info.tokenMint!).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              })}
            >
              {copied ? "Copied" : `CA ${info.tokenMint.slice(0, 4)}…${info.tokenMint.slice(-4)}`}
            </button>
          )}
          {info?.sourceUrl && (
            <a className="link" href={info.sourceUrl} target="_blank" rel="noopener noreferrer">
              Program source
            </a>
          )}
        </nav>
      </div>
    </footer>
  );
}
