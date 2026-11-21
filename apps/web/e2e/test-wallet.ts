/**
 * A Wallet Standard wallet for Playwright: registers in the page like Phantom would, and signs with a keypair
 * held in the Node test process (the page never sees the secret key).
 */
import type { Page } from "@playwright/test";
import { Keypair, VersionedTransaction } from "@solana/web3.js";
import nacl from "tweetnacl";

export async function installTestWallet(page: Page, keypair: Keypair, name = "Lotz Test Wallet"): Promise<void> {
  await page.exposeFunction("__lotzSignTx", (b64: string) => {
    const tx = VersionedTransaction.deserialize(Buffer.from(b64, "base64"));
    tx.sign([keypair]);
    return Buffer.from(tx.serialize()).toString("base64");
  });
  await page.exposeFunction("__lotzSignMsg", (b64: string) => {
    const sig = nacl.sign.detached(Buffer.from(b64, "base64"), keypair.secretKey);
    return Buffer.from(sig).toString("base64");
  });
  await page.addInitScript(
    ({ address, pubkey, name }) => {
      const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
      const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
      const chains = ["solana:mainnet", "solana:devnet", "solana:testnet", "solana:localnet"];
      const account = {
        address,
        publicKey: Uint8Array.from(pubkey),
        chains,
        features: ["solana:signTransaction", "solana:signMessage"],
      };
      const listeners: Record<string, ((...a: unknown[]) => void)[]> = {};
      const w = window as unknown as Record<string, (s: string) => Promise<string>>;
      const wallet = {
        version: "1.0.0",
        name,
        icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxIDEiPjxyZWN0IHdpZHRoPSIxIiBoZWlnaHQ9IjEiLz48L3N2Zz4=",
        chains,
        accounts: [] as (typeof account)[],
        features: {
          "standard:connect": {
            version: "1.0.0",
            connect: async () => {
              wallet.accounts = [account];
              (listeners.change ?? []).forEach((l) => l({ accounts: wallet.accounts }));
              return { accounts: wallet.accounts };
            },
          },
          "standard:disconnect": {
            version: "1.0.0",
            disconnect: async () => {
              wallet.accounts = [];
            },
          },
          "standard:events": {
            version: "1.0.0",
            on: (event: string, l: (...a: unknown[]) => void) => {
              (listeners[event] ??= []).push(l);
              return () => {
                listeners[event] = (listeners[event] ?? []).filter((x) => x !== l);
              };
            },
          },
          "solana:signTransaction": {
            version: "1.0.0",
            supportedTransactionVersions: ["legacy", 0],
            signTransaction: async (...inputs: { transaction: Uint8Array }[]) =>
              Promise.all(inputs.map(async (i) => ({ signedTransaction: unb64(await w.__lotzSignTx!(b64(i.transaction))) }))),
          },
          "solana:signMessage": {
            version: "1.0.0",
            signMessage: async (...inputs: { message: Uint8Array }[]) =>
              Promise.all(inputs.map(async (i) => ({ signedMessage: i.message, signature: unb64(await w.__lotzSignMsg!(b64(i.message))) }))),
          },
        },
      };
      const register = ({ register }: { register: (w: unknown) => void }) => register(wallet);
      window.addEventListener("wallet-standard:app-ready", (e) => register((e as CustomEvent).detail));
      try {
        window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: register }));
      } catch {
        /* the app registers it on app-ready */
      }
    },
    { address: keypair.publicKey.toBase58(), pubkey: Array.from(keypair.publicKey.toBytes()), name },
  );
}
