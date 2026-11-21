import { lotView } from "@/lib/server/views";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ x: string; y: string }> }) {
  const { x, y } = await ctx.params;
  const lx = Number(x);
  const ly = Number(y);
  if (!Number.isInteger(lx) || !Number.isInteger(ly) || lx < 0 || ly < 0 || lx > 99 || ly > 99) {
    return Response.json({ error: "x and y are lot coordinates, 0..99" }, { status: 400 });
  }
  return Response.json(await lotView(lx, ly), { headers: { "cache-control": "public, max-age=0, s-maxage=2" } });
}
