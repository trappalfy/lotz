import { activityView } from "@/lib/server/views";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const u = new URL(req.url);
  const limit = Math.min(100, Math.max(1, Number(u.searchParams.get("limit") ?? 30) || 30));
  const beforeRaw = u.searchParams.get("before");
  const before = beforeRaw && /^\d+$/.test(beforeRaw) ? Number(beforeRaw) : undefined;
  return Response.json(await activityView(limit, before), {
    headers: { "cache-control": "public, max-age=0, s-maxage=2" },
  });
}
