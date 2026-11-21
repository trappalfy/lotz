/** Private keys as wallets export them (base58) or as the Solana CLI stores them (JSON byte array). */
import { Keypair } from "@solana/web3.js";

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function decodeBase58(s: string): Uint8Array {
  let n = 0n;
  for (const c of s) {
    const i = ALPHABET.indexOf(c);
    if (i < 0) throw new Error("not base58");
    n = n * 58n + BigInt(i);
  }
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.unshift(Number(n % 256n));
    n /= 256n;
  }
  for (const c of s) {
    if (c !== "1") break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

/** A 64-byte secret key from base58 or a JSON array; checks that its public half matches. */
export function parseSecret(text: string): Keypair {
  const t = text.trim();
  const bytes = t.startsWith("[") ? Uint8Array.from(JSON.parse(t) as number[]) : decodeBase58(t);
  if (bytes.length !== 64) throw new Error(`expected a 64-byte secret key, got ${bytes.length} bytes`);
  return Keypair.fromSecretKey(bytes); // validates the public key against the secret
}
