import { statsView } from "@/lib/server/views";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await statsView(), {
    headers: { "cache-control": "public, max-age=0, s-maxage=2, stale-while-revalidate=10" },
  });
}
