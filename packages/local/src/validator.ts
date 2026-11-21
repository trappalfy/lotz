/** Starts a solana-test-validator with the Lotz program deployed as upgradeable. Local only. */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import { Connection, PublicKey } from "@solana/web3.js";

export interface ValidatorOptions {
  ledger: string;
  programSo: string;
  programId: PublicKey;
  upgradeAuthority: PublicKey;
  /** RPC port; websocket is rpcPort + 1. */
  rpcPort: number;
  faucetPort: number;
  gossipPort: number;
  dynamicPortRange: string;
  reset?: boolean;
}

export interface RunningValidator {
  url: string;
  wsUrl: string;
  process: ChildProcess;
  stop(): Promise<void>;
}

export async function startValidator(o: ValidatorOptions): Promise<RunningValidator> {
  mkdirSync(o.ledger, { recursive: true });
  const args = [
    "--ledger",
    o.ledger,
    "--bind-address",
    "127.0.0.1",
    "--rpc-port",
    String(o.rpcPort),
    "--faucet-port",
    String(o.faucetPort),
    "--gossip-port",
    String(o.gossipPort),
    "--dynamic-port-range",
    o.dynamicPortRange,
    "--upgradeable-program",
    o.programId.toBase58(),
    o.programSo,
    o.upgradeAuthority.toBase58(),
    "--quiet",
  ];
  if (o.reset) args.push("--reset");
  const child = spawn("solana-test-validator", args, { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  child.stderr?.on("data", (d) => (stderr += String(d)));
  const url = `http://127.0.0.1:${o.rpcPort}`;
  const wsUrl = `ws://127.0.0.1:${o.rpcPort + 1}`;
  const connection = new Connection(url, "confirmed");
  const started = Date.now();
  for (;;) {
    if (child.exitCode !== null) throw new Error(`solana-test-validator exited: ${stderr}`);
    try {
      const slot = await connection.getSlot();
      const prog = await connection.getAccountInfo(o.programId);
      if (slot > 1 && prog?.executable) break;
    } catch {
      /* not up yet */
    }
    if (Date.now() - started > 60_000) {
      child.kill("SIGKILL");
      throw new Error(`validator did not start: ${stderr}`);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return {
    url,
    wsUrl,
    process: child,
    stop: () =>
      new Promise((resolve) => {
        if (child.exitCode !== null) return resolve();
        child.once("exit", () => resolve());
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
      }),
  };
}
