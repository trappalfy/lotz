"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  MAX_PRIOR_ADS,
  MAX_TITLE_CHARS,
  formatTokens,
  linkDomain,
  linkError,
  quoteRect,
  titleError,
  type Quote,
  type Rect,
} from "@lotz/sdk";
import { useLotz } from "@/lib/client/lotz-context";
import { BoardBehindError, PriceMovedError, buy, freshQuote, tokenBalance } from "@/lib/client/buy";
import { explainError } from "@/lib/client/errors";
import { TooLargeError, explorerTx } from "@/lib/client/send";
import { useSelection } from "./selection";
import { useWalletModal } from "./WalletModal";
import { ImageCropper, type Crop } from "./ImageCropper";
import { Icon } from "./icons";

type Phase = "idle" | "uploading" | "quoting" | "signing" | "sending" | "confirming" | "done";

const PHASE_TEXT: Record<Phase, string> = {
  idle: "Pay & post",
  uploading: "Uploading the image…",
  quoting: "Checking the price…",
  signing: "Confirm in your wallet…",
  sending: "Sending…",
  confirming: "Confirming…",
  done: "Posted",
};

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 py-1 ${strong ? "font-semibold" : ""}`}>
      <span className={strong ? "" : "text-mute"}>{label}</span>
      <span className="num">{value}</span>
    </div>
  );
}

function Stepper({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-1">
      <span className="w-4 text-mute">{label}</span>
      <button type="button" className="btn btn-sm h-7 w-7 px-0" aria-label={`${label} minus one`} disabled={value <= min} onClick={() => onChange(value - 1)}>
        <Icon name="minus" size={11} />
      </button>
      <span className="num w-7 text-center">{value}</span>
      <button type="button" className="btn btn-sm h-7 w-7 px-0" aria-label={`${label} plus one`} disabled={value >= max} onClick={() => onChange(value + 1)}>
        <Icon name="plus" size={11} />
      </button>
    </div>
  );
}

export function BuyPanel() {
  const { board, info, connection, ixs, stats } = useLotz();
  const { rect, setRect, setSelecting } = useSelection();
  const { publicKey, sendTransaction } = useWallet();
  const { open: openWallet } = useWalletModal();
  const dec = info?.tokenDecimals ?? 6;
  const maxRect = board?.params?.maxRect ?? 10;

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [crop, setCrop] = useState<Crop | null>(null);
  const [link, setLink] = useState("https://");
  const [title, setTitle] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [chainQuote, setChainQuote] = useState<Quote | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [touched, setTouched] = useState(false);
  const upload = useRef<{ key: string; hash: string; uri: string } | null>(null);

  // local quote from the indexed board, replaced by a fresh on-chain one
  const localQuote = useMemo(() => {
    if (!rect || !board?.params) return null;
    return quoteRect(board.toLots(), rect, board.params);
  }, [rect, board]);
  const quote = chainQuote ?? localQuote;

  // One on-chain quote shortly after the selection settles. Between purchases the indexed board (live stream) keeps
  // the local quote current, and paying re-quotes from the chain anyway: no polling, so a crowd of open panels does
  // not use up the RPC allowance.
  const boardRef = useRef(board);
  boardRef.current = board;
  const boardReady = !!board;
  useEffect(() => {
    setChainQuote(null);
    if (!rect || !connection || !ixs || !boardReady) return;
    let alive = true;
    const t = setTimeout(() => {
      const b = boardRef.current;
      if (!b) return;
      freshQuote(connection, ixs, b, rect, publicKey)
        .then((q) => alive && setChainQuote(q.quote))
        .catch(() => {});
    }, 400);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [rect, connection, ixs, boardReady, publicKey]);

  useEffect(() => {
    if (!publicKey || !connection || !ixs) {
      setBalance(null);
      return;
    }
    void tokenBalance(connection, ixs, publicKey).then(setBalance);
  }, [publicKey, connection, ixs, done]);

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // a new rectangle shape needs a new crop and upload
  useEffect(() => {
    upload.current = null;
  }, [rect?.w, rect?.h, crop, file]);

  const close = useCallback(() => {
    setRect(null);
    setSelecting(false);
    setPhase("idle");
    setError(null);
    setDone(null);
  }, [setRect, setSelecting]);

  if (!rect) return null;

  const ownLots = (() => {
    if (!board || !publicKey) return 0;
    let n = 0;
    for (let ly = rect.y; ly < rect.y + rect.h; ly++)
      for (let lx = rect.x; lx < rect.x + rect.w; lx++) if (board.adAt(lx, ly)?.owner === publicKey.toBase58()) n++;
    return n;
  })();
  const tooManyAds = (quote?.priorAdIds.length ?? 0) > MAX_PRIOR_ADS;
  const linkErr = linkError(link);
  const titleErr = titleError(title);
  const short = balance !== null && quote ? quote.total > balance : false;
  const busy = phase !== "idle" && phase !== "done";
  const blockers = [
    ownLots > 0 && `You own ${ownLots} of these lots. Move or shrink the selection.`,
    tooManyAds && `This spot takes lots from ${quote!.priorAdIds.length} ads; at most ${MAX_PRIOR_ADS} per purchase. Make it smaller.`,
    stats?.paused && "Buying is paused right now.",
  ].filter(Boolean) as string[];
  const canPay = !!quote && !!file && !!crop && !linkErr && !titleErr && !short && blockers.length === 0 && !busy;

  const move = (next: Partial<Rect>) => {
    const r = { ...rect, ...next };
    r.w = Math.min(maxRect, Math.max(1, r.w));
    r.h = Math.min(maxRect, Math.max(1, r.h));
    r.x = Math.min(100 - r.w, Math.max(0, r.x));
    r.y = Math.min(100 - r.h, Math.max(0, r.y));
    setRect(r);
    setDone(null);
    setError(null);
  };

  const pay = async () => {
    setTouched(true);
    if (!canPay || !publicKey || !connection || !ixs || !board || !quote || !file || !crop) return;
    setError(null);
    try {
      if (!upload.current) {
        setPhase("uploading");
        const form = new FormData();
        form.set("file", file);
        form.set("w", String(rect.w));
        form.set("h", String(rect.h));
        form.set("crop", JSON.stringify(crop));
        const r = await fetch("/api/upload", { method: "POST", body: form });
        const j = (await r.json()) as { hash?: string; uri?: string; error?: string };
        if (!r.ok || !j.hash || !j.uri) throw new Error(j.error ?? "Upload failed");
        upload.current = { key: "", hash: j.hash, uri: j.uri };
      }
      const hash = Uint8Array.from(upload.current.hash.match(/../g)!.map((h) => parseInt(h, 16)));
      const res = await buy(
        connection,
        ixs,
        board,
        publicKey,
        sendTransaction,
        rect,
        { imageHash: hash, imageUri: upload.current.uri, link: link.trim(), title: title.trim() },
        quote.total,
        { lookupTable: info?.lookupTable ?? null, priorityMicroLamports: info?.priorityMicroLamports ?? 0 },
        (s) => setPhase(s),
      );
      setPhase("done");
      setDone(res.signature);
    } catch (e) {
      setPhase("idle");
      if (e instanceof PriceMovedError) setChainQuote({ ...quote, total: e.total });
      if (e instanceof TooLargeError) {
        setError(
          "This purchase does not fit in one transaction: it takes lots from many ads and the link or title is long. Shorten the link or title, or pick fewer taken lots.",
        );
      } else if (e instanceof BoardBehindError || e instanceof PriceMovedError) setError(e.message);
      else setError(explainError(e));
    }
  };

  const takenPart = quote ? quote.total - BigInt(quote.freeLots) * quote.freeLotPrice : 0n;

  return (
    <aside
      aria-label="Buy lots"
      className="panel fixed inset-x-0 bottom-0 z-30 max-h-[62dvh] overflow-y-auto md:sticky md:inset-auto md:top-[68px] md:max-h-[calc(100dvh-88px)] md:w-[360px] md:shrink-0"
    >
      <div className="sticky top-0 z-10 flex h-9 items-center justify-between bg-ink pl-3 pr-1 text-paper">
        <span className="text-sm font-semibold">Buy lots</span>
        <button type="button" aria-label="Close" className="flex h-7 w-7 items-center justify-center hover:bg-white/15" onClick={close}>
          <Icon name="close" size={12} />
        </button>
      </div>

      <div className="space-y-5 p-4 text-[14px]">
        {done ? (
          <div>
            <p className="font-semibold">Posted. Your ad is on the board.</p>
            <p className="mt-1 text-mute">If someone takes a lot from it later, everything you paid for that lot comes back to you.</p>
            <div className="mt-4 flex flex-wrap gap-3">
              <a className="btn btn-sm" href={explorerTx(done, info?.cluster ?? "localnet")} target="_blank" rel="noopener noreferrer">
                View transaction <Icon name="external" size={10} />
              </a>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => {
                  setDone(null);
                  setFile(null);
                  setTitle("");
                  setRect(null);
                }}
              >
                Buy more
              </button>
            </div>
          </div>
        ) : (
          <>
            <section className="space-y-2">
              <div className="num flex items-baseline justify-between">
                <span className="text-[15px] font-semibold">
                  {rect.w} × {rect.h} lots
                </span>
                <span className="text-mute">
                  at {rect.x}, {rect.y} · {rect.w * 10}×{rect.h * 10} px
                </span>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-2 text-[13px]">
                <Stepper label="w" value={rect.w} min={1} max={maxRect} onChange={(w) => move({ w })} />
                <Stepper label="h" value={rect.h} min={1} max={maxRect} onChange={(h) => move({ h })} />
                <Stepper label="x" value={rect.x} min={0} max={100 - rect.w} onChange={(x) => move({ x })} />
                <Stepper label="y" value={rect.y} min={0} max={100 - rect.h} onChange={(y) => move({ y })} />
              </div>
            </section>

            <section className="border-t-2 border-ink pt-3 text-[13px]">
              {quote ? (
                <>
                  <Row label="Free lots" value={`${quote.freeLots} × ${formatTokens(quote.freeLotPrice, dec)}`} />
                  <Row label="Taken lots (1.5x)" value={quote.takenLots ? `${quote.takenLots} · ${formatTokens(takenPart, dec)}` : "none"} />
                  <div className="my-1 border-t border-grid" />
                  <Row label="Goes to the lock" value={formatTokens(quote.locked, dec)} />
                  <Row label="Goes back to previous owners" value={formatTokens(quote.refunds, dec)} />
                  <div className="my-1 border-t border-grid" />
                  <Row label="You pay" value={formatTokens(quote.total, dec)} strong />
                  {balance !== null && (
                    <p className={`num mt-1 text-right text-[12px] ${short ? "text-ink font-semibold" : "text-mute"}`}>
                      {short ? `You have ${formatTokens(balance, dec)}. Not enough.` : `You have ${formatTokens(balance, dec)}`}
                    </p>
                  )}
                </>
              ) : info && !info.initialized ? (
                <p>Buying is not open yet.</p>
              ) : (
                <p className="text-mute">Loading prices…</p>
              )}
            </section>

            {blockers.map((b) => (
              <p key={b} className="border-2 border-ink p-2 text-[13px]">
                {b}
              </p>
            ))}

            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold">Image</span>
                <label className="btn btn-sm cursor-pointer">
                  <Icon name="image" size={12} />
                  {file ? "Change" : "Choose image"}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="sr-only"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      if (f.size > 2 * 1024 * 1024) {
                        setError("Images are at most 2 MB.");
                        return;
                      }
                      setError(null);
                      setFile(f);
                    }}
                  />
                </label>
              </div>
              {preview ? (
                <ImageCropper src={preview} aspect={rect.w / rect.h} onChange={(c) => setCrop(c)} />
              ) : (
                <p className="text-[13px] text-mute">PNG, JPG or WebP, static, up to 2 MB. You pick the part that fits the lots.</p>
              )}
              {touched && !file && <p className="text-[13px] font-semibold">Choose an image.</p>}
            </section>

            <section className="space-y-3">
              <label className="block">
                <span className="mb-1 block font-semibold">Link</span>
                <input
                  className="field num text-[13px]"
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                  value={link}
                  onChange={(e) => setLink(e.target.value.replace(/\s/g, ""))}
                  aria-invalid={touched && !!linkErr}
                />
                {(touched || link.length > 8) && linkErr ? (
                  <span className="mt-1 block text-[12px] font-semibold">{linkErr}</span>
                ) : linkDomain(link) ? (
                  <span className="mt-1 block text-[12px] text-mute">Visitors see {linkDomain(link)} before they leave.</span>
                ) : null}
              </label>
              <label className="block">
                <span className="mb-1 flex justify-between font-semibold">
                  Title <span className="num text-[12px] font-normal text-mute">{[...title].length}/{MAX_TITLE_CHARS}</span>
                </span>
                <input className="field" value={title} maxLength={MAX_TITLE_CHARS * 2} onChange={(e) => setTitle(e.target.value)} placeholder="Shown on hover" />
                {titleErr && <span className="mt-1 block text-[12px] font-semibold">{titleErr}</span>}
              </label>
              <p className="text-[12px] leading-relaxed text-mute">
                The ad cannot be changed after you pay. Its lots can be taken at 1.5x; you get back what you paid for each one.
              </p>
            </section>

            {error && (
              <p role="alert" className="border-2 border-ink p-2 text-[13px]">
                {error}
              </p>
            )}

            {publicKey ? (
              <button type="button" className="btn btn-primary w-full" disabled={!canPay && (touched || busy || blockers.length > 0 || short)} onClick={pay} aria-busy={busy}>
                {PHASE_TEXT[phase]}
              </button>
            ) : (
              <button type="button" className="btn btn-primary w-full" onClick={openWallet}>
                Connect wallet to pay
              </button>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
