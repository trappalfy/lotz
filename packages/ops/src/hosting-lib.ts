/** What `hosting` changes, worked out without touching any service (so it can be tested). */
import type { Env } from "./mainnet-env";

export interface RemoteVar {
  id: string;
  key: string;
  target?: string[];
}

/** Vercel environments the site's variables go to. Preview builds get the same settings (and the same lock). */
export const VERCEL_TARGETS = ["production", "preview"] as const;

/** Removed from Vercel when empty in .env.mainnet: emptying SITE_ACCESS_KEY there is how the site opens. */
export const REMOVABLE = ["SITE_ACCESS_KEY"];

export function vercelChanges(local: Env, remote: RemoteVar[]): { set: string[]; remove: RemoteVar[] } {
  return {
    set: Object.keys(local).sort(),
    remove: remote.filter((r) => REMOVABLE.includes(r.key) && !local[r.key]),
  };
}

/** Vercel API path with the team, when the project belongs to one. */
export function vercelPath(path: string, team: string | undefined): string {
  if (!team) return path;
  return `${path}${path.includes("?") ? "&" : "?"}slug=${encodeURIComponent(team)}`;
}
