"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { shortAddress } from "@lotz/sdk";
import { useLotz } from "@/lib/client/lotz-context";
import { explorerTx } from "@/lib/client/send";
import { useWalletModal } from "./WalletModal";

interface AdminAd {
  id: number;
  owner: string;
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  link: string;
  domain: string | null;
  lotsAlive: number;
  closed: boolean;
  hidden: boolean;
  hiddenReason: string | null;
  imageStatus: string;
  imageError: string | null;
  image: string | null;
  createdAt: string;
  signature: string | null;
}

interface Domain {
  domain: string;
  note: string | null;
  addedAt: string;
}

const headers = { "content-type": "application/json", "x-lotz-admin": "1" };

export function AdminPage() {
  const { info, tick } = useLotz();
  const { publicKey, signMessage } = useWallet();
  const { open } = useWalletModal();
  const [admin, setAdmin] = useState<string | null | undefined>(undefined);
  const [ads, setAds] = useState<AdminAd[]>([]);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [domain, setDomain] = useState("");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "visible" | "hidden">("all");

  useEffect(() => {
    fetch("/api/admin/session")
      .then((r) => r.json() as Promise<{ admin: string | null }>)
      .then((j) => setAdmin(j.admin))
      .catch(() => setAdmin(null));
  }, []);

  const load = useCallback(async () => {
    const [a, d] = await Promise.all([fetch("/api/admin/ads", { cache: "no-store" }), fetch("/api/admin/domains", { cache: "no-store" })]);
    if (a.ok) setAds((await a.json()) as AdminAd[]);
    if (d.ok) setDomains((await d.json()) as Domain[]);
  }, []);

  useEffect(() => {
    if (admin) void load();
  }, [admin, load, tick]);

  const signIn = async () => {
    setMsg(null);
    if (!publicKey || !signMessage) return;
    try {
      const { message } = (await (await fetch("/api/admin/nonce")).json()) as { message: string };
      const sig = await signMessage(new TextEncoder().encode(message));
      const r = await fetch("/api/admin/session", {
        method: "POST",
        headers,
        body: JSON.stringify({ publicKey: publicKey.toBase58(), message, signature: btoa(String.fromCharCode(...sig)) }),
      });
      const j = (await r.json()) as { admin?: string; error?: string };
      if (!r.ok) throw new Error(j.error ?? "Sign-in failed");
      setAdmin(j.admin ?? null);
    } catch (e) {
      setMsg(String((e as Error).message ?? e));
    }
  };

  const moderate = async (id: number, action: "hide" | "unhide") => {
    const r = await fetch(`/api/admin/ads/${id}`, { method: "POST", headers, body: JSON.stringify({ action }) });
    const j = (await r.json()) as { error?: string };
    setMsg(r.ok ? (action === "hide" ? `Ad ${id} hidden.` : `Ad ${id} is visible again.`) : (j.error ?? "Failed"));
    void load();
  };

  const block = async () => {
    const r = await fetch("/api/admin/domains", { method: "POST", headers, body: JSON.stringify({ domain, note: note || undefined }) });
    const j = (await r.json()) as { error?: string; hidden?: number };
    setMsg(r.ok ? `Blocked ${domain}. ${j.hidden ?? 0} ads hidden.` : (j.error ?? "Failed"));
    if (r.ok) {
      setDomain("");
      setNote("");
    }
    void load();
  };

  const unblock = async (d: string) => {
    const r = await fetch("/api/admin/domains", { method: "DELETE", headers, body: JSON.stringify({ domain: d }) });
    const j = (await r.json()) as { error?: string; unhidden?: number };
    setMsg(r.ok ? `Unblocked ${d}. ${j.unhidden ?? 0} ads visible again.` : (j.error ?? "Failed"));
    void load();
  };

  const signOut = async () => {
    await fetch("/api/admin/session", { method: "DELETE" });
    setAdmin(null);
  };

  const shown = ads.filter((a) => (filter === "all" ? true : filter === "hidden" ? a.hidden : !a.hidden));

  return (
    <main className="relative z-10 mx-auto w-full max-w-[1100px] px-4 pb-24 pt-[110px] lg:pt-[90px]">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h1 className="text-[28px] font-bold tracking-tight">Moderation</h1>
        {admin && (
          <span className="num text-[13px] text-mute">
            {shortAddress(admin)}{" "}
            <button type="button" className="link ml-2" onClick={signOut}>
              Sign out
            </button>
          </span>
        )}
      </div>
      <p className="mt-2 max-w-[640px] text-[14px] text-mute">
        Hiding only changes this site: the ad stays on-chain and its lots can still be taken over.
      </p>

      {admin === undefined ? (
        <p className="mt-6 text-mute">Loading…</p>
      ) : !admin ? (
        <div className="panel mt-6 max-w-[520px] p-5">
          <p className="text-[15px]">Sign in with the admin wallet. You sign a message; no transaction is sent.</p>
          {publicKey ? (
            <button type="button" className="btn btn-primary mt-4" onClick={signIn} disabled={!signMessage}>
              Sign in as {shortAddress(publicKey.toBase58())}
            </button>
          ) : (
            <button type="button" className="btn btn-primary mt-4" onClick={open}>
              Connect wallet
            </button>
          )}
          {msg && <p className="mt-3 text-[14px]">{msg}</p>}
        </div>
      ) : (
        <>
          {msg && (
            <p role="status" className="mt-4 border-2 border-ink bg-paper p-2 text-[14px]">
              {msg}
            </p>
          )}
          <div className="mt-6 grid items-start gap-6 lg:grid-cols-[1fr_320px]">
            <section>
              <div className="flex items-center gap-2">
                <h2 className="mr-auto text-[18px] font-bold">New ads</h2>
                {(["all", "visible", "hidden"] as const).map((f) => (
                  <button key={f} type="button" className={`btn btn-sm ${filter === f ? "btn-primary" : ""}`} onClick={() => setFilter(f)}>
                    {f}
                  </button>
                ))}
              </div>
              <ul className="mt-4 space-y-4">
                {shown.map((a) => (
                  <li key={a.id} className="panel grid gap-4 p-4 sm:grid-cols-[140px_1fr_auto]">
                    <div className="flex h-[100px] w-[140px] items-center justify-center border border-grid">
                      {a.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={a.image} alt="" className="max-h-full max-w-full" style={{ imageRendering: "pixelated" }} />
                      ) : (
                        <span className="text-[12px] text-mute">{a.imageStatus}</span>
                      )}
                    </div>
                    <div className="min-w-0 text-[14px]">
                      <div className="font-semibold break-words">
                        #{a.id} {a.title || <span className="text-mute">no title</span>}
                      </div>
                      <div className="num break-all text-[12px]">{a.link}</div>
                      <div className="num mt-1 text-[12px] text-mute">
                        {a.w}×{a.h} at {a.x}, {a.y} · {a.lotsAlive} lots alive · owner {shortAddress(a.owner)} ·{" "}
                        {new Date(a.createdAt).toLocaleString("en-GB")}
                        {a.closed && " · closed"}
                      </div>
                      {a.hidden && <div className="mt-1 text-[12px] font-semibold">hidden ({a.hiddenReason})</div>}
                      {a.imageError && <div className="text-[12px] text-mute">{a.imageError}</div>}
                      {a.signature && (
                        <a className="link text-[12px]" href={explorerTx(a.signature, info?.cluster ?? "localnet")} target="_blank" rel="noopener noreferrer">
                          transaction
                        </a>
                      )}
                    </div>
                    <div>
                      {a.hidden ? (
                        <button type="button" className="btn btn-sm" disabled={a.imageStatus === "mismatch"} onClick={() => moderate(a.id, "unhide")}>
                          Show again
                        </button>
                      ) : (
                        <button type="button" className="btn btn-sm btn-primary" onClick={() => moderate(a.id, "hide")}>
                          Hide
                        </button>
                      )}
                    </div>
                  </li>
                ))}
                {shown.length === 0 && <li className="text-[14px] text-mute">Nothing here.</li>}
              </ul>
            </section>
            <section className="panel p-4">
              <h2 className="text-[16px] font-bold">Blocked domains</h2>
              <p className="mt-1 text-[12px] text-mute">Ads linking to a blocked domain or any of its subdomains are hidden, now and later.</p>
              <form
                className="mt-3 space-y-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void block();
                }}
              >
                <input className="field num text-[13px]" placeholder="example.com" value={domain} onChange={(e) => setDomain(e.target.value)} />
                <input className="field text-[13px]" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
                <button type="submit" className="btn btn-sm btn-primary" disabled={!domain.trim()}>
                  Block domain
                </button>
              </form>
              <ul className="mt-4 divide-y divide-grid text-[13px]">
                {domains.map((d) => (
                  <li key={d.domain} className="flex items-center justify-between gap-2 py-2">
                    <span className="min-w-0">
                      <span className="num block truncate">{d.domain}</span>
                      {d.note && <span className="block truncate text-[12px] text-mute">{d.note}</span>}
                    </span>
                    <button type="button" className="btn btn-sm" onClick={() => unblock(d.domain)}>
                      Unblock
                    </button>
                  </li>
                ))}
                {domains.length === 0 && <li className="py-2 text-mute">None yet.</li>}
              </ul>
            </section>
          </div>
        </>
      )}
    </main>
  );
}
