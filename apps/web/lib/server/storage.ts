import "server-only";
import { storageFromEnv, type Storage } from "@lotz/storage";

const g = globalThis as unknown as { __lotzStorage?: Storage };

export function storage(): Storage {
  g.__lotzStorage ??= storageFromEnv();
  return g.__lotzStorage;
}
