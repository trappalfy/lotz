/**
 * Automatic image screening with a local model: nsfwjs (MobileNetV2Mid) on TensorFlow.js with the WebAssembly
 * backend, so no native code and no outside service. The upload endpoint refuses flagged images before anyone pays; the indexer hides ads whose
 * image was hosted elsewhere. Moderators can still unhide anything in /admin.
 */
import sharp, { type Sharp } from "sharp";
import type { NSFWJS } from "nsfwjs";

export type NsfwClass = "Drawing" | "Hentai" | "Neutral" | "Porn" | "Sexy";
export type Scores = Record<NsfwClass, number>;

export interface Verdict {
  unsafe: boolean;
  /** Per class, the highest probability over the regions that were checked. */
  scores: Scores;
}

export interface Thresholds {
  /** Porn + Hentai at or above this hides the image. */
  explicit: number;
  /** Sexy at or above this hides the image. */
  suggestive: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = { explicit: 0.6, suggestive: 0.9 };

/** `NSFW_FILTER=off` turns screening off; `NSFW_EXPLICIT` / `NSFW_SUGGESTIVE` override the thresholds. */
export function screeningFromEnv(env: Record<string, string | undefined> = process.env): Thresholds | null {
  if ((env.NSFW_FILTER ?? "on").toLowerCase() === "off") return null;
  const num = (v: string | undefined, d: number) => {
    const n = Number(v);
    return v && Number.isFinite(n) && n > 0 && n <= 1 ? n : d;
  };
  return {
    explicit: num(env.NSFW_EXPLICIT, DEFAULT_THRESHOLDS.explicit),
    suggestive: num(env.NSFW_SUGGESTIVE, DEFAULT_THRESHOLDS.suggestive),
  };
}

export function judge(scores: Scores, t: Thresholds = DEFAULT_THRESHOLDS): boolean {
  return scores.Porn + scores.Hentai >= t.explicit || scores.Sexy >= t.suggestive;
}

const INPUT_PX = 224;

export interface Region {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Regions to classify. Ads are rectangles up to 10:1; squashing a long strip into the model's square input hides
 * what is in it, so anything longer than 2:1 is checked as 2:1 pieces that together cover the whole image
 * (at most five for 10:1).
 */
export function regionsOf(width: number, height: number): Region[] {
  const long = Math.max(width, height);
  const short = Math.min(width, height);
  const span = short * 2;
  if (long <= span) return [{ left: 0, top: 0, width, height }];
  const n = Math.ceil(long / span);
  const step = (long - span) / (n - 1);
  const out: Region[] = [];
  for (let i = 0; i < n; i++) {
    const at = Math.round(i * step);
    out.push(width >= height ? { left: at, top: 0, width: span, height: short } : { left: 0, top: at, width: short, height: span });
  }
  return out;
}

let loading: Promise<{ tf: typeof import("@tensorflow/tfjs"); model: NSFWJS }> | null = null;

function load() {
  loading ??= (async () => {
    // both libraries print setup hints on load; keep the service logs clean
    const { log, info, warn } = console;
    console.log = console.info = console.warn = () => {};
    try {
      const tf = await import("@tensorflow/tfjs");
      const nsfw = await import("nsfwjs");
      // WebAssembly runs the model ~30x faster than plain JS (about 25 ms per image); plain JS is the fallback
      let wasm = false;
      try {
        await import("@tensorflow/tfjs-backend-wasm");
        wasm = await tf.setBackend("wasm");
      } catch {
        wasm = false;
      }
      if (!wasm) await tf.setBackend("cpu");
      await tf.ready();
      return { tf, model: await nsfw.load("MobileNetV2Mid") };
    } finally {
      console.log = log;
      console.info = info;
      console.warn = warn;
    }
  })();
  loading.catch(() => {
    loading = null;
  });
  return loading;
}

/** Loads the model ahead of the first image (about a second). Returns the TensorFlow backend in use. */
export async function warmUp(): Promise<string> {
  const { tf } = await load();
  return tf.getBackend();
}

type Source = () => Sharp;

async function classify(source: Source, width: number, height: number, t: Thresholds): Promise<Verdict> {
  const { tf, model } = await load();
  const scores: Scores = { Drawing: 0, Hentai: 0, Neutral: 0, Porn: 0, Sexy: 0 };
  for (const r of regionsOf(width, height)) {
    const { data } = await source()
      .extract(r)
      .resize(INPUT_PX, INPUT_PX, { fit: "contain", background: "#ffffff" })
      .flatten({ background: "#ffffff" })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const img = tf.tensor3d(new Uint8Array(data), [INPUT_PX, INPUT_PX, 3], "int32");
    try {
      for (const p of await model.classify(img, 5)) {
        const c = p.className as NsfwClass;
        scores[c] = Math.max(scores[c], p.probability);
      }
    } finally {
      img.dispose();
    }
  }
  return { unsafe: judge(scores, t), scores };
}

/** Screens an encoded image (PNG, JPEG, WebP). */
export async function screenImage(bytes: Uint8Array, t: Thresholds = DEFAULT_THRESHOLDS): Promise<Verdict> {
  const meta = await sharp(bytes).rotate().metadata();
  const oriented = (meta.orientation ?? 1) >= 5;
  const width = oriented ? meta.height! : meta.width!;
  const height = oriented ? meta.width! : meta.height!;
  return classify(() => sharp(bytes).rotate(), width, height, t);
}

/** Screens raw pixels (RGBA or RGB), as the indexer holds them after decoding an ad image. */
export async function screenRaw(
  raw: Uint8Array,
  width: number,
  height: number,
  channels: 3 | 4,
  t: Thresholds = DEFAULT_THRESHOLDS,
): Promise<Verdict> {
  return classify(() => sharp(raw, { raw: { width, height, channels } }), width, height, t);
}
