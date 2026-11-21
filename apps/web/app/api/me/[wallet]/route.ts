import { PublicKey } from "@solana/web3.js";
import { meView } from "@/lib/server/views";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ wallet: string }> }) {
  const { wallet } = await ctx.params;
  try {
    new PublicKey(wallet);
  } catch {
    return Response.json({ error: "not a wallet address" }, { status: 400 });
  }
  return Response.json(await meView(wallet), { headers: { "cache-control": "no-store" } });
}
