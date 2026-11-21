import { MODERATION_CHANNEL, getAd, logModeration, notify, setHidden } from "@lotz/db";
import { pool } from "@/lib/server/db";
import { currentAdmin, hasCsrfHeader } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/** Body: { action: "hide" | "unhide" }. The ad stays on-chain; only the site changes. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await currentAdmin();
  if (!admin || !hasCsrfHeader(req)) return Response.json({ error: "not signed in" }, { status: 401 });
  const { id } = await ctx.params;
  const adId = Number(id);
  const body = (await req.json().catch(() => null)) as { action?: string } | null;
  if (!Number.isInteger(adId) || !["hide", "unhide"].includes(body?.action ?? "")) {
    return Response.json({ error: "bad request" }, { status: 400 });
  }
  const p = pool();
  const ad = await getAd(p, adId);
  if (!ad) return Response.json({ error: "no such ad" }, { status: 404 });
  if (body!.action === "unhide" && ad.imageStatus === "mismatch") {
    return Response.json({ error: "The image does not match its on-chain hash; it stays hidden" }, { status: 409 });
  }
  await setHidden(p, adId, body!.action === "hide", "admin", admin);
  await logModeration(p, admin, body!.action!, `ad:${adId}`);
  await notify(p, MODERATION_CHANNEL, { adIds: [adId] });
  return Response.json({ ok: true });
}
