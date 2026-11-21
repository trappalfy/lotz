import { deploymentInfo } from "@/lib/server/views";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const origin = new URL(req.url).origin;
  return Response.json(await deploymentInfo(origin), { headers: { "cache-control": "no-store" } });
}
