/**
 * Saves a wallet's private key (as Phantom or Solflare export it, base58; or a JSON byte array) into a keypair file
 * the CLI tools can sign with. The key is read with the input hidden and goes nowhere but the file.
 *
 *   pnpm --filter @lotz/ops import-key                        # writes keys/admin.json
 *   pnpm --filter @lotz/ops import-key keys/admin.json <expected address>
 *
 * Refuses to overwrite an existing file. keys/ is gitignored.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { repoRoot } from "./common";
import { parseSecret } from "./keyfile";

async function readHidden(prompt: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    let s = "";
    for await (const chunk of stdin) s += String(chunk);
    return s;
  }
  process.stdout.write(prompt);
  stdin.setRawMode(true);
  stdin.setEncoding("utf8");
  stdin.resume();
  return new Promise((done, fail) => {
    let s = "";
    const finish = (err?: Error) => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write("\n");
      if (err) fail(err);
      else done(s);
    };
    const onData = (chunk: string) => {
      for (const c of chunk) {
        if (c === "\r" || c === "\n") return finish();
        if (c === "\u0003") return finish(new Error("cancelled"));
        if (c === "\u007f" || c === "\b") s = s.slice(0, -1);
        else s += c;
      }
    };
    stdin.on("data", onData);
  });
}

{
  const [outArg, expected] = process.argv.slice(2).filter((a) => a !== "--");
  const out = resolve(outArg ? resolve(process.env.INIT_CWD ?? process.cwd(), outArg) : resolve(repoRoot(), "keys/admin.json"));
  if (existsSync(out)) {
    console.error(`${out} already exists; not overwriting it.`);
    process.exit(1);
  }
  const kp = parseSecret(await readHidden("Paste the private key (input is hidden), then Enter: "));
  const address = kp.publicKey.toBase58();
  if (expected && expected !== address) {
    console.error(`This key belongs to ${address}, not ${expected}. Nothing written.`);
    process.exit(1);
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(Array.from(kp.secretKey)), { mode: 0o600 });
  console.log(`Saved ${out}\nAddress: ${address}`);
}
