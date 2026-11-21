import { mathView } from "@/lib/server/views";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await mathView(), { headers: { "cache-control": "public, max-age=0, s-maxage=10" } });
}
