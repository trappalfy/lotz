/**
 * Keeps the whole site closed until launch. While SITE_ACCESS_KEY is set, every request (pages, API, files) gets a
 * blank page with the wordmark, unless the browser carries the access cookie. Opening https://<site>/?access=<key>
 * once sets that cookie for a year. Remove SITE_ACCESS_KEY and redeploy to open the site to everyone.
 */
import { STAR, downsample } from "@lotz/brand";

export const ACCESS_COOKIE = "lotz_access";
export const ACCESS_PARAM = "access";
export const ACCESS_MAX_AGE = 365 * 24 * 60 * 60;

export type Gate =
  | { kind: "open" }
  /** the right key in the URL: set the cookie and send the browser to the same page without the key */
  | { kind: "enter"; location: string }
  | { kind: "closed" };

export function decide(key: string | undefined, url: URL, cookie: string | undefined): Gate {
  if (!key) return { kind: "open" };
  const given = url.searchParams.get(ACCESS_PARAM);
  if (given !== null) {
    if (!same(given, key)) return { kind: "closed" };
    const clean = new URL(url);
    clean.searchParams.delete(ACCESS_PARAM);
    return { kind: "enter", location: clean.pathname + clean.search };
  }
  return cookie !== undefined && same(cookie, key) ? { kind: "open" } : { kind: "closed" };
}

/** Compares without stopping at the first differing character. */
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

let page: string | undefined;

/** What a visitor without the cookie sees: the wordmark and nothing else. */
export function closedPage(): string {
  if (page) return page;
  // the same star as the header (components/Logo.tsx)
  const small = downsample(STAR, 3, 0.2);
  const [w, h] = [small[0]!.length, small.length];
  let d = "";
  small.forEach((row, y) => row.forEach((on, x) => (on ? (d += `M${x} ${y}h1v1h-1z`) : undefined)));
  const star = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${(26 * w) / h}" height="26" shape-rendering="crispEdges" aria-hidden="true"><path d="${d}" fill="#0a0a0a"/></svg>`;
  page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Lotz</title><style>html,body{height:100%;margin:0;background:#fff;color:#0a0a0a}body{display:flex;align-items:center;justify-content:center;gap:8px;font:700 22px/1 ui-sans-serif,system-ui,sans-serif;letter-spacing:-0.025em}</style></head><body>${star}<span>Lotz</span></body></html>`;
  return page;
}
