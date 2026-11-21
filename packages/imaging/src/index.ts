/**
 * Image handling shared by the upload endpoint and the indexer (brief §4):
 * - only static PNG, JPEG or WebP, at most 2 MB;
 * - cropped to the rectangle's proportions and resized to `w*40 x h*40` px (4x the logical pixels);
 * - flattened onto white, metadata stripped, encoded as WebP, hashed with sha256.
 */
import { createHash } from "node:crypto";
import sharp, { type Metadata } from "sharp";

export { safeFetch, isPublicAddress, type SafeFetchOptions } from "./safe-fetch";

/** Stored image pixels per logical pixel. */
export const IMAGE_SCALE = 4;
/** Stored pixels per lot side (10 logical px x 4). */
export const LOT_IMAGE_PX = 40;
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
/** Decoder guard against decompression bombs. */
export const MAX_INPUT_PIXELS = 40_000_000;

export class ImageError extends Error {}

export type SourceFormat = "png" | "jpeg" | "webp";

/** Format from magic bytes, or null. */
export function sniffFormat(b: Uint8Array): SourceFormat | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  )
    return "webp";
  return null;
}

/** True if a PNG has an `acTL` chunk before its first `IDAT` (an animated PNG). */
export function isApng(b: Uint8Array): boolean {
  let off = 8;
  while (off + 8 <= b.length) {
    const len = (b[off]! << 24) | (b[off + 1]! << 16) | (b[off + 2]! << 8) | b[off + 3]!;
    const type = String.fromCharCode(b[off + 4]!, b[off + 5]!, b[off + 6]!, b[off + 7]!);
    if (type === "acTL") return true;
    if (type === "IDAT") return false;
    off += 12 + (len >>> 0);
  }
  return false;
}

export function sha256Hex(b: Uint8Array): string {
  return createHash("sha256").update(b).digest("hex");
}

export interface Crop {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Probe {
  format: SourceFormat;
  /** Size after EXIF orientation, which is what the browser shows and the crop refers to. */
  width: number;
  height: number;
}

/** Checks a file is a static PNG/JPEG/WebP within limits; returns its oriented size. */
export async function probe(input: Uint8Array): Promise<Probe> {
  if (input.length === 0) throw new ImageError("Empty file");
  if (input.length > MAX_UPLOAD_BYTES) throw new ImageError("Images are at most 2 MB");
  const format = sniffFormat(input);
  if (!format) throw new ImageError("Use a PNG, JPG or WebP image");
  if (format === "png" && isApng(input)) throw new ImageError("Animated images are not allowed");
  let meta: Metadata;
  try {
    meta = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, animated: true }).metadata();
  } catch {
    throw new ImageError("This image could not be read");
  }
  if (meta.format !== format) throw new ImageError("The file type does not match its contents");
  if ((meta.pages ?? 1) > 1) throw new ImageError("Animated images are not allowed");
  if (!meta.width || !meta.height) throw new ImageError("This image could not be read");
  const rotated = (meta.orientation ?? 1) >= 5;
  return { format, width: rotated ? meta.height : meta.width, height: rotated ? meta.width : meta.height };
}

/** Default crop: the largest centered region with the rectangle's proportions. */
export function centerCrop(width: number, height: number, w: number, h: number): Crop {
  const target = w / h;
  if (width / height > target) {
    const cw = Math.max(1, Math.round(height * target));
    return { left: Math.floor((width - cw) / 2), top: 0, width: cw, height };
  }
  const ch = Math.max(1, Math.round(width / target));
  return { left: 0, top: Math.floor((height - ch) / 2), width, height: ch };
}

function checkCrop(c: Crop, p: Probe): Crop {
  const n = {
    left: Math.round(c.left),
    top: Math.round(c.top),
    width: Math.round(c.width),
    height: Math.round(c.height),
  };
  if (![n.left, n.top, n.width, n.height].every(Number.isFinite)) throw new ImageError("Bad crop");
  if (n.left < 0 || n.top < 0 || n.width < 1 || n.height < 1) throw new ImageError("Bad crop");
  if (n.left + n.width > p.width || n.top + n.height > p.height) throw new ImageError("Crop is outside the image");
  return n;
}

export interface Processed {
  bytes: Uint8Array;
  hash: string;
  width: number;
  height: number;
}

/**
 * Crops (in oriented source pixels), resizes to `w*40 x h*40`, flattens onto white, strips metadata, encodes WebP.
 * A crop with slightly different proportions is stretched to fit; the client sends the rectangle's ratio.
 */
export async function processUpload(input: Uint8Array, w: number, h: number, crop?: Crop): Promise<Processed> {
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w > 10 || h > 10) {
    throw new ImageError("Bad rectangle size");
  }
  const p = await probe(input);
  const c = checkCrop(crop ?? centerCrop(p.width, p.height, w, h), p);
  const width = w * LOT_IMAGE_PX;
  const height = h * LOT_IMAGE_PX;
  const lossless = p.format === "png";
  const bytes = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
    .rotate()
    .extract(c)
    .resize(width, height, { fit: "fill", kernel: "lanczos3" })
    .flatten({ background: "#ffffff" })
    .webp(lossless ? { lossless: true, effort: 4 } : { quality: 90, effort: 4 })
    .toBuffer();
  const out = new Uint8Array(bytes);
  return { bytes: out, hash: sha256Hex(out), width, height };
}

/**
 * Decodes a stored or fetched ad image to raw RGBA of exactly `w*40 x h*40` (cover-fit if the size differs, as it
 * may for an image that did not come through our upload).
 */
export async function decodeAdImage(input: Uint8Array, w: number, h: number): Promise<Buffer> {
  const width = w * LOT_IMAGE_PX;
  const height = h * LOT_IMAGE_PX;
  const format = sniffFormat(input);
  if (!format) throw new ImageError("not a PNG, JPEG or WebP image");
  if (format === "png" && isApng(input)) throw new ImageError("animated image");
  const img = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS });
  const meta = await img.metadata();
  if ((meta.pages ?? 1) > 1) throw new ImageError("animated image");
  return img
    .rotate()
    .resize(width, height, { fit: "cover", kernel: "lanczos3" })
    .flatten({ background: "#ffffff" })
    .ensureAlpha()
    .raw()
    .toBuffer();
}

/** Re-encodes a raw RGBA ad image for serving (our copy of an external image). */
export async function encodeWebp(raw: Buffer, width: number, height: number): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp(raw, { raw: { width, height, channels: 4 } }).webp({ quality: 90, effort: 4 }).toBuffer(),
  );
}

/** Colors of the design system (brief §6.1). */
export const COLORS = {
  paper: [0xff, 0xff, 0xff],
  grid: [0xde, 0xde, 0xde],
  gridStrong: [0xc4, 0xc4, 0xc4],
  ink: [0x0a, 0x0a, 0x0a],
  mute: [0x6b, 0x6b, 0x6b],
} as const;

/**
 * The `hidden` pattern for one lot at 4x (40 x 40 RGBA): `--grid` and `--paper` in a 1-logical-pixel checker
 * (4 x 4 device pixels), aligned to the board so neighbouring lots join seamlessly.
 */
export function hiddenLotPattern(): Buffer {
  const px = LOT_IMAGE_PX;
  const out = Buffer.alloc(px * px * 4);
  for (let y = 0; y < px; y++) {
    for (let x = 0; x < px; x++) {
      const on = (Math.floor(x / IMAGE_SCALE) + Math.floor(y / IMAGE_SCALE)) % 2 === 0;
      const c = on ? COLORS.grid : COLORS.paper;
      const i = (y * px + x) * 4;
      out[i] = c[0];
      out[i + 1] = c[1];
      out[i + 2] = c[2];
      out[i + 3] = 255;
    }
  }
  return out;
}
