import { cookies } from "next/headers";
import { COOKIE, currentAdmin, sessionValue, verifySignIn } from "@/lib/server/session";
import { allow, clientIp } from "@/lib/server/ratelimit";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ admin: await currentAdmin() }, { headers: { "cache-control": "no-store" } });
}

/** Body: { publicKey, message, signature (base64) }. */
export async function POST(req: Request) {
  if (!allow(`admin-login:${clientIp(req)}`, 10, 5)) return Response.json({ error: "rate limited" }, { status: 429 });
  const body = (await req.json().catch(() => null)) as { publicKey?: string; message?: string; signature?: string } | null;
  if (!body?.publicKey || !body.message || !body.signature) return Response.json({ error: "bad request" }, { status: 400 });
  const wallet = verifySignIn(body.publicKey, body.message, body.signature);
  if (!wallet) return Response.json({ error: "This wallet is not an admin, or the signature is wrong or expired" }, { status: 403 });
  const { value, maxAge } = sessionValue(wallet);
  (await cookies()).set(COOKIE, value, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  });
  return Response.json({ admin: wallet });
}

export async function DELETE() {
  (await cookies()).delete(COOKIE);
  return Response.json({ admin: null });
}
