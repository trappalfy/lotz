import { describe, expect, it } from "vitest";
import { closedPage, decide } from "@/lib/gate";

const KEY = "k3y-0f-th1rty-tw0-characters-xxxxxx";
const url = (s: string) => new URL(s, "https://lotz.fun");

describe("site gate", () => {
  it("is open when no key is set", () => {
    expect(decide(undefined, url("/"), undefined)).toEqual({ kind: "open" });
    expect(decide(undefined, url("/api/stats"), "anything")).toEqual({ kind: "open" });
  });

  it("is closed without the cookie, for pages, API and files", () => {
    for (const p of ["/", "/me", "/api/stats", "/api/lock", "/_next/static/chunks/a.js", "/icon.svg", "/robots.txt"]) {
      expect(decide(KEY, url(p), undefined)).toEqual({ kind: "closed" });
    }
  });

  it("opens with the right cookie only", () => {
    expect(decide(KEY, url("/"), KEY)).toEqual({ kind: "open" });
    expect(decide(KEY, url("/"), KEY.slice(0, -1))).toEqual({ kind: "closed" });
    expect(decide(KEY, url("/"), KEY + "x")).toEqual({ kind: "closed" });
    expect(decide(KEY, url("/"), "")).toEqual({ kind: "closed" });
  });

  it("the key in the URL lets you in and is dropped from the address", () => {
    expect(decide(KEY, url(`/?access=${KEY}`), undefined)).toEqual({ kind: "enter", location: "/" });
    expect(decide(KEY, url(`/me?x=1&access=${KEY}`), undefined)).toEqual({ kind: "enter", location: "/me?x=1" });
    expect(decide(KEY, url("/?access=wrong"), undefined)).toEqual({ kind: "closed" });
    expect(decide(KEY, url("/?access="), undefined)).toEqual({ kind: "closed" });
  });

  it("the closed page shows nothing but the wordmark", () => {
    const html = closedPage();
    expect(html).toContain("<title>Lotz</title>");
    expect(html).toContain("noindex");
    const body = html.replace(/<head>.*<\/head>/s, "").replace(/<[^>]+>/g, "").trim();
    expect(body).toBe("Lotz");
  });
});
