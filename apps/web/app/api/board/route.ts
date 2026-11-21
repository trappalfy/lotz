import { boardView } from "@/lib/server/views";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await boardView(), {
    headers: { "cache-control": "public, max-age=0, s-maxage=1, stale-while-revalidate=5" },
  });
}
