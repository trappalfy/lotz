/** Reads and updates the repository's .env without touching keys it does not set. */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

export function readEnv(path: string): Map<string, string> {
  const out = new Map<string, string>();
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out.set(m[1]!, m[2]!);
  }
  return out;
}

/** Writes `values` into `path`, creating it from `template` if missing; other lines stay as they are. */
export function updateEnv(path: string, template: string, values: Record<string, string>): void {
  const text = existsSync(path) ? readFileSync(path, "utf8") : existsSync(template) ? readFileSync(template, "utf8") : "";
  const lines = text.split("\n");
  const pending = new Map(Object.entries(values));
  const next = lines.map((line) => {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && pending.has(m[1]!)) {
      const v = pending.get(m[1]!)!;
      pending.delete(m[1]!);
      return `${m[1]}=${v}`;
    }
    return line;
  });
  for (const [k, v] of pending) next.push(`${k}=${v}`);
  writeFileSync(path, next.join("\n"), { mode: 0o600 });
}

export function randomSecret(): string {
  return randomBytes(32).toString("base64url");
}
