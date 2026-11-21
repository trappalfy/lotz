/**
 * Object storage for images and board renders. `local` writes files under a directory (dev; the web app serves
 * them at /media); `s3` talks to any S3-compatible store (Cloudflare R2, AWS S3) behind a CDN.
 */
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

export interface Storage {
  /** Stores `body` at `key` and returns its public URL. */
  put(key: string, body: Uint8Array, contentType: string, cacheControl?: string): Promise<string>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
  publicUrl(key: string): string;
  /** The key of a public URL produced by this storage, or null if the URL is elsewhere. */
  keyOf(url: string): string | null;
}

/** Long-lived, content-addressed or versioned objects. */
export const IMMUTABLE = "public, max-age=31536000, immutable";

export function assertKey(key: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._\-/]*$/.test(key) || key.includes("..") || key.length > 200) {
    throw new Error(`bad storage key: ${key}`);
  }
}

function joinUrl(base: string, key: string): string {
  return `${base.replace(/\/+$/, "")}/${key}`;
}

export class LocalStorage implements Storage {
  readonly root: string;
  constructor(
    root: string,
    readonly publicBase: string,
  ) {
    this.root = resolve(root);
  }

  private path(key: string): string {
    assertKey(key);
    const p = resolve(join(this.root, key));
    if (!p.startsWith(this.root + sep)) throw new Error(`bad storage key: ${key}`);
    return p;
  }

  async put(key: string, body: Uint8Array, _contentType: string): Promise<string> {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    const tmp = `${p}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, body);
    await rename(tmp, p);
    return this.publicUrl(key);
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(this.path(key)));
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }

  publicUrl(key: string): string {
    return joinUrl(this.publicBase, key);
  }

  keyOf(url: string): string | null {
    const base = this.publicBase.replace(/\/+$/, "") + "/";
    return url.startsWith(base) ? url.slice(base.length) : null;
  }
}

export class S3Storage implements Storage {
  private client: S3Client;
  constructor(
    private bucket: string,
    readonly publicBase: string,
    opts: { endpoint?: string; region?: string; accessKeyId: string; secretAccessKey: string },
  ) {
    this.client = new S3Client({
      region: opts.region ?? "auto",
      endpoint: opts.endpoint || undefined,
      credentials: { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey },
      forcePathStyle: !!opts.endpoint,
    });
  }

  async put(key: string, body: Uint8Array, contentType: string, cacheControl = IMMUTABLE): Promise<string> {
    assertKey(key);
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType, CacheControl: cacheControl }),
    );
    return this.publicUrl(key);
  }

  async get(key: string): Promise<Uint8Array | null> {
    assertKey(key);
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return res.Body ? new Uint8Array(await res.Body.transformToByteArray()) : null;
    } catch (e) {
      if ((e as { name?: string }).name === "NoSuchKey") return null;
      throw e;
    }
  }

  async delete(key: string): Promise<void> {
    assertKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  publicUrl(key: string): string {
    return joinUrl(this.publicBase, key);
  }

  keyOf(url: string): string | null {
    const base = this.publicBase.replace(/\/+$/, "") + "/";
    return url.startsWith(base) ? url.slice(base.length) : null;
  }
}

/** Storage from STORAGE_* environment variables. */
export function storageFromEnv(env: NodeJS.ProcessEnv = process.env): Storage {
  const driver = env.STORAGE_DRIVER ?? "local";
  const publicBase = env.STORAGE_PUBLIC_URL;
  if (!publicBase) throw new Error("STORAGE_PUBLIC_URL is not set");
  if (driver === "local") {
    return new LocalStorage(env.STORAGE_LOCAL_DIR ?? ".data/storage", publicBase);
  }
  if (driver === "s3") {
    const { STORAGE_S3_BUCKET, STORAGE_S3_ACCESS_KEY_ID, STORAGE_S3_SECRET_ACCESS_KEY } = env;
    if (!STORAGE_S3_BUCKET || !STORAGE_S3_ACCESS_KEY_ID || !STORAGE_S3_SECRET_ACCESS_KEY) {
      throw new Error("STORAGE_S3_BUCKET, STORAGE_S3_ACCESS_KEY_ID and STORAGE_S3_SECRET_ACCESS_KEY are required");
    }
    return new S3Storage(STORAGE_S3_BUCKET, publicBase, {
      endpoint: env.STORAGE_S3_ENDPOINT,
      region: env.STORAGE_S3_REGION,
      accessKeyId: STORAGE_S3_ACCESS_KEY_ID,
      secretAccessKey: STORAGE_S3_SECRET_ACCESS_KEY,
    });
  }
  throw new Error(`unknown STORAGE_DRIVER ${driver}`);
}

export function contentTypeOf(key: string): string {
  if (key.endsWith(".png")) return "image/png";
  if (key.endsWith(".webp")) return "image/webp";
  if (key.endsWith(".jpg") || key.endsWith(".jpeg")) return "image/jpeg";
  if (key.endsWith(".json")) return "application/json";
  return "application/octet-stream";
}
