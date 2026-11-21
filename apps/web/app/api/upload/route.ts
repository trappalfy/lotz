import { ImageError, MAX_UPLOAD_BYTES, processUpload, type Crop } from "@lotz/imaging";
import { insertUpload, rateHit } from "@lotz/db";
import { screenImage, screeningFromEnv } from "@lotz/moderation";
import { IMMUTABLE } from "@lotz/storage";
import { pool } from "@/lib/server/db";
import { storage } from "@/lib/server/storage";
import { allow, clientIp } from "@/lib/server/ratelimit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// the first upload on a fresh server instance also loads the screening model (about a second)
export const maxDuration = 30;

const UPLOADS_PER_HOUR = 60;

/**
 * POST multipart: `file` (PNG/JPG/WebP, static, <= 2 MB), `w`, `h` (rectangle in lots), optional `crop`
 * (JSON {left, top, width, height} in the image's pixels). Returns `{ hash, uri, width, height }`; the buy
 * transaction carries `hash` and `uri`.
 */
export async function POST(req: Request) {
  const ip = clientIp(req);
  if (!allow(`upload:${ip}`, 20, 10) || (await rateHit(pool(), `upload:${ip}`, 3_600)) > UPLOADS_PER_HOUR) {
    return Response.json({ error: "Too many uploads, wait a minute" }, { status: 429 });
  }
  const length = Number(req.headers.get("content-length") ?? "0");
  if (length > MAX_UPLOAD_BYTES + 64 * 1024) {
    return Response.json({ error: "Images are at most 2 MB" }, { status: 413 });
  }
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "Send the image as multipart/form-data" }, { status: 400 });
  }
  const file = form.get("file");
  const w = Number(form.get("w"));
  const h = Number(form.get("h"));
  if (!(file instanceof File)) return Response.json({ error: "No file" }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES) return Response.json({ error: "Images are at most 2 MB" }, { status: 413 });
  let crop: Crop | undefined;
  const cropRaw = form.get("crop");
  if (typeof cropRaw === "string" && cropRaw) {
    try {
      const c = JSON.parse(cropRaw) as Crop;
      crop = { left: Number(c.left), top: Number(c.top), width: Number(c.width), height: Number(c.height) };
    } catch {
      return Response.json({ error: "Bad crop" }, { status: 400 });
    }
  }
  try {
    const out = await processUpload(new Uint8Array(await file.arrayBuffer()), w, h, crop);
    const thresholds = screeningFromEnv();
    if (thresholds) {
      // refuse before anyone pays; if the check itself fails, the indexer checks again after the purchase
      const verdict = await screenImage(out.bytes, thresholds).catch((e) => {
        console.error("image screening failed", e);
        return null;
      });
      if (verdict?.unsafe) {
        return Response.json({ error: "This image can't go on the board: it looks like adult content." }, { status: 422 });
      }
    }
    const key = `i/${out.hash}.webp`;
    const uri = await storage().put(key, out.bytes, "image/webp", IMMUTABLE);
    await insertUpload(pool(), { hash: out.hash, key, width: out.width, height: out.height, bytes: out.bytes.length });
    return Response.json({ hash: out.hash, uri, width: out.width, height: out.height });
  } catch (e) {
    if (e instanceof ImageError) return Response.json({ error: e.message }, { status: 400 });
    console.error("upload failed", e);
    return Response.json({ error: "Upload failed" }, { status: 500 });
  }
}
