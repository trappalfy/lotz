import { contentTypeOf } from "@lotz/storage";
import { storage } from "@/lib/server/storage";
import { env } from "@/lib/server/env";

export const runtime = "nodejs";

/** Serves the local storage directory in development. With S3/R2 the CDN serves objects directly. */
export async function GET(_req: Request, ctx: { params: Promise<{ key: string[] }> }) {
  if (env.storageDriver() !== "local") return new Response("not found", { status: 404 });
  const { key } = await ctx.params;
  const path = key.join("/");
  let bytes: Uint8Array | null;
  try {
    bytes = await storage().get(path);
  } catch {
    return new Response("not found", { status: 404 });
  }
  if (!bytes) return new Response("not found", { status: 404 });
  const versioned = /-\d+\.png$|^i\/|^ads\/|^og\/og-/.test(path);
  return new Response(Buffer.from(bytes), {
    headers: {
      "content-type": contentTypeOf(path),
      "cache-control": versioned ? "public, max-age=31536000, immutable" : "public, max-age=60",
      "x-content-type-options": "nosniff",
    },
  });
}
