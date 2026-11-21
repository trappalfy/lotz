import {
  MODERATION_CHANNEL,
  addBlockedDomain,
  getAdsOnDomain,
  getBlockedDomains,
  logModeration,
  notify,
  removeBlockedDomain,
  setHidden,
} from "@lotz/db";
import { pool } from "@/lib/server/db";
import { currentAdmin, hasCsrfHeader } from "@/lib/server/session";

export const dynamic = "force-dynamic";

function normalize(input: unknown): string | null {
  if (typeof input !== "string") return null;
  let d = input.trim().toLowerCase();
  try {
    if (d.includes("://")) d = new URL(d).hostname;
  } catch {
    return null;
  }
  d = d.replace(/^www\./, "").replace(/\.$/, "");
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d) ? d : null;
}

export async function GET() {
  if (!(await currentAdmin())) return Response.json({ error: "not signed in" }, { status: 401 });
  return Response.json(await getBlockedDomains(pool()), { headers: { "cache-control": "no-store" } });
}

/** Body: { domain, note? }. Hides every ad linking to the domain or its subdomains. */
export async function POST(req: Request) {
  const admin = await currentAdmin();
  if (!admin || !hasCsrfHeader(req)) return Response.json({ error: "not signed in" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { domain?: string; note?: string } | null;
  const domain = normalize(body?.domain);
  if (!domain) return Response.json({ error: "Enter a domain like example.com" }, { status: 400 });
  const p = pool();
  await addBlockedDomain(p, domain, body?.note?.slice(0, 200) ?? null, admin);
  const ads = await getAdsOnDomain(p, domain);
  for (const ad of ads) if (!ad.hidden) await setHidden(p, ad.adId, true, "blocked_domain", admin);
  await logModeration(p, admin, "block_domain", domain, body?.note);
  await notify(p, MODERATION_CHANNEL, { adIds: ads.map((a) => a.adId) });
  return Response.json({ ok: true, hidden: ads.length });
}

/** Body: { domain }. Unhides the ads that were hidden only because of this domain. */
export async function DELETE(req: Request) {
  const admin = await currentAdmin();
  if (!admin || !hasCsrfHeader(req)) return Response.json({ error: "not signed in" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { domain?: string } | null;
  const domain = normalize(body?.domain);
  if (!domain) return Response.json({ error: "bad domain" }, { status: 400 });
  const p = pool();
  await removeBlockedDomain(p, domain);
  const remaining = (await getBlockedDomains(p)).map((d) => d.domain);
  const ads = await getAdsOnDomain(p, domain);
  const changed: number[] = [];
  for (const ad of ads) {
    const still = ad.linkDomain && remaining.some((b) => ad.linkDomain === b || ad.linkDomain!.endsWith(`.${b}`));
    if (ad.hidden && ad.hiddenReason === "blocked_domain" && !still) {
      await setHidden(p, ad.adId, false, null, null);
      changed.push(ad.adId);
    }
  }
  await logModeration(p, admin, "unblock_domain", domain);
  await notify(p, MODERATION_CHANNEL, { adIds: changed });
  return Response.json({ ok: true, unhidden: changed.length });
}
