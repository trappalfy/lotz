import { signInMessage } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return Response.json({ message: signInMessage(new URL(req.url).host) }, { headers: { "cache-control": "no-store" } });
}
