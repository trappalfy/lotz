import { listRecentAds } from "@lotz/db";
import { pool } from "@/lib/server/db";
import { currentAdmin } from "@/lib/server/session";
import { storage } from "@/lib/server/storage";

export const dynamic = "force-dynamic";

/** Newest ads first, with everything moderation needs (including hidden content). */
export async function GET(req: Request) {
  if (!(await currentAdmin())) return Response.json({ error: "not signed in" }, { status: 401 });
  const u = new URL(req.url);
  const before = Number(u.searchParams.get("before")) || undefined;
  const ads = await listRecentAds(pool(), 50, before);
  return Response.json(
    ads.map((a) => ({
      id: a.adId,
      address: a.address,
      owner: a.owner,
      x: a.x,
      y: a.y,
      w: a.w,
      h: a.h,
      title: a.title,
      link: a.link,
      domain: a.linkDomain,
      lotsAlive: a.lotsAlive,
      closed: a.closed,
      hidden: a.hidden,
      hiddenReason: a.hiddenReason,
      imageStatus: a.imageStatus,
      imageError: a.imageError,
      image: a.imageKey ? storage().publicUrl(a.imageKey) : null,
      imageUri: a.imageUri,
      createdAt: a.createdAt.toISOString(),
      signature: a.signature,
    })),
    { headers: { "cache-control": "no-store" } },
  );
}
