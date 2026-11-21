import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, ACCESS_MAX_AGE, closedPage, decide } from "@/lib/gate";

/** Runs before every request, static files included (no matcher). See lib/gate.ts. */
export function proxy(request: NextRequest) {
  const gate = decide(process.env.SITE_ACCESS_KEY?.trim() || undefined, request.nextUrl, request.cookies.get(ACCESS_COOKIE)?.value);
  if (gate.kind === "open") return NextResponse.next();
  if (gate.kind === "enter") {
    const res = NextResponse.redirect(new URL(gate.location, request.url), 303);
    res.cookies.set({
      name: ACCESS_COOKIE,
      value: process.env.SITE_ACCESS_KEY!.trim(),
      path: "/",
      httpOnly: true,
      secure: request.nextUrl.protocol === "https:",
      sameSite: "lax",
      maxAge: ACCESS_MAX_AGE,
    });
    res.headers.set("Cache-Control", "no-store");
    res.headers.set("Referrer-Policy", "no-referrer");
    return res;
  }
  return new NextResponse(closedPage(), {
    status: 404,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
