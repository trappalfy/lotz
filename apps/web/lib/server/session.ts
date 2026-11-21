import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import nacl from "tweetnacl";
import { PublicKey } from "@solana/web3.js";
import { cookies } from "next/headers";
import { env } from "./env";

/**
 * Admin sign-in: the server hands out a message with a signed, expiring nonce; the admin's wallet signs it;
 * the server checks the wallet signature and that the key is an admin, then sets an HMAC-signed session cookie.
 */
export const COOKIE = "lotz_admin";
const NONCE_TTL_MS = 5 * 60_000;
const SESSION_TTL_S = 12 * 60 * 60;

const mac = (data: string) => createHmac("sha256", env.sessionSecret()).update(data).digest("base64url");

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function signInMessage(host: string): string {
  const nonce = randomBytes(16).toString("base64url");
  const exp = Date.now() + NONCE_TTL_MS;
  const token = `${nonce}.${exp}`;
  return `Lotz admin sign-in\nSite: ${host}\nNonce: ${token}.${mac(`nonce:${token}`)}\n\nThis does not send a transaction or cost anything.`;
}

/** Returns the wallet if the message is ours, fresh, signed by it, and the wallet is an admin. */
export function verifySignIn(publicKey: string, message: string, signatureB64: string): string | null {
  const m = /^Nonce: ([A-Za-z0-9_-]+)\.(\d+)\.([A-Za-z0-9_-]+)$/m.exec(message);
  if (!m) return null;
  const [, nonce, exp, tag] = m;
  if (!safeEqual(mac(`nonce:${nonce}.${exp}`), tag!)) return null;
  if (Date.now() > Number(exp)) return null;
  let key: PublicKey;
  try {
    key = new PublicKey(publicKey);
  } catch {
    return null;
  }
  const sig = Buffer.from(signatureB64, "base64");
  if (sig.length !== 64) return null;
  if (!nacl.sign.detached.verify(new TextEncoder().encode(message), sig, key.toBytes())) return null;
  const wallet = key.toBase58();
  return env.adminWallets().includes(wallet) ? wallet : null;
}

export function sessionValue(wallet: string): { value: string; maxAge: number } {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_S;
  const body = `${wallet}.${exp}`;
  return { value: `${body}.${mac(`session:${body}`)}`, maxAge: SESSION_TTL_S };
}

/** The signed-in admin wallet, or null. */
export async function currentAdmin(): Promise<string | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return null;
  const parts = raw.split(".");
  if (parts.length !== 3) return null;
  const [wallet, exp, tag] = parts as [string, string, string];
  if (!safeEqual(mac(`session:${wallet}.${exp}`), tag)) return null;
  if (Date.now() / 1000 > Number(exp)) return null;
  return env.adminWallets().includes(wallet) ? wallet : null;
}

/** Mutating admin calls must carry this header (a cross-site form cannot set it). */
export function hasCsrfHeader(req: Request): boolean {
  return req.headers.get("x-lotz-admin") === "1";
}
