import { describe, expect, it } from "vitest";
import { Keypair } from "@solana/web3.js";
import { bs58 } from "@lotz/sdk";
import { decodeBase58, parseSecret } from "../src/keyfile";

describe("keyfile", () => {
  it("decodes base58 like the encoder in the sdk, leading zeros included", () => {
    for (const bytes of [new Uint8Array([0, 0, 1, 2, 255]), new Uint8Array(32).fill(7), new Uint8Array([0])]) {
      expect(decodeBase58(bs58(bytes))).toEqual(bytes);
    }
  });

  it("reads a wallet export (base58) and a CLI file (JSON array)", () => {
    const kp = Keypair.generate();
    expect(parseSecret(` ${bs58(kp.secretKey)}\n`).publicKey.toBase58()).toBe(kp.publicKey.toBase58());
    expect(parseSecret(JSON.stringify(Array.from(kp.secretKey))).publicKey.toBase58()).toBe(kp.publicKey.toBase58());
  });

  it("refuses anything that is not a whole, consistent secret key", () => {
    const kp = Keypair.generate();
    expect(() => parseSecret(bs58(kp.publicKey.toBytes()))).toThrow(/64-byte/);
    expect(() => parseSecret("0OIl")).toThrow(/base58/);
    const broken = Uint8Array.from(kp.secretKey);
    broken[40] ^= 1; // public half no longer matches the secret half
    expect(() => parseSecret(bs58(broken))).toThrow();
  });
});
