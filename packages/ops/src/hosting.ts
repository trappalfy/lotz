/**
 * Puts the settings from .env.mainnet into Vercel (the site) and Railway (the indexer). Plan only by default; never
 * prints a value.
 *
 *   pnpm --filter @lotz/ops hosting             # what would change
 *   pnpm --filter @lotz/ops hosting --apply     # set the variables, redeploy the site, set up the indexer's domain
 *
 * Vercel through its API (VERCEL_TOKEN, VERCEL_PROJECT, VERCEL_TEAM). Railway through the logged-in CLI, in the
 * project linked to the repository folder (`railway link`), service RAILWAY_SERVICE (default "@lotz/indexer", see .railway/railway.ts).
 * An empty SITE_ACCESS_KEY is removed from Vercel: that is how the site opens to everyone.
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { repoRoot } from "./common";
import { derive, indexerEnv, parseEnvFile, siteEnv } from "./mainnet-env";
import { VERCEL_TARGETS, vercelChanges, vercelPath, type RemoteVar } from "./hosting-lib";

const apply = process.argv.includes("--apply");
const e = derive(parseEnvFile(resolve(repoRoot(), ".env.mainnet")));
const site = siteEnv(e);
const indexer = indexerEnv(e);
const domain = e.SITE_DOMAIN?.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
const live = domain ? `live.${domain}` : undefined;
let failed = false;

// ---------------------------------------------------------------- Vercel
console.log("\nVercel (site)");
if (!e.VERCEL_TOKEN || !e.VERCEL_PROJECT) {
  console.log("  VERCEL_TOKEN or VERCEL_PROJECT is empty: skipped");
} else {
  const api = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const res = await fetch(`https://api.vercel.com${vercelPath(path, e.VERCEL_TEAM || undefined)}`, {
      method,
      headers: { authorization: `Bearer ${e.VERCEL_TOKEN}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path.replace(/\?.*/, "")}: ${res.status} ${text.slice(0, 300)}`);
    return (text ? JSON.parse(text) : {}) as T;
  };
  try {
    const project = await api<{
      id: string;
      name: string;
      rootDirectory?: string | null;
      nodeVersion?: string;
      link?: { type?: string; repoId?: number; repo?: string; org?: string; productionBranch?: string };
    }>("GET", `/v9/projects/${encodeURIComponent(e.VERCEL_PROJECT)}`);
    const { envs } = await api<{ envs: RemoteVar[] }>("GET", `/v10/projects/${project.id}/env`);
    const changes = vercelChanges(site, envs);
    console.log(`  project      ${project.name}, root ${project.rootDirectory ?? "(repository root)"}, Node ${project.nodeVersion ?? "?"}`);
    console.log(`  repository   ${project.link?.org ?? "?"}/${project.link?.repo ?? "?"} (${project.link?.productionBranch ?? "main"})`);
    if (project.rootDirectory !== "apps/web") console.log("  ! Root Directory should be apps/web (Settings → Build and Deployment)");
    console.log(`  set          ${changes.set.join(", ")}`);
    if (changes.remove.length) console.log(`  remove       ${changes.remove.map((r) => r.key).join(", ")}  (empty in .env.mainnet: the site opens)`);
    const others = envs.filter((r) => !changes.set.includes(r.key) && !changes.remove.includes(r)).map((r) => r.key);
    if (others.length) console.log(`  left as is   ${[...new Set(others)].join(", ")}`);
    if (apply) {
      await api("POST", `/v10/projects/${project.id}/env?upsert=true`, changes.set.map((key) => ({ key, value: site[key], type: "encrypted", target: [...VERCEL_TARGETS] })));
      for (const r of changes.remove) await api("DELETE", `/v9/projects/${project.id}/env/${r.id}`);
      if (!project.nodeVersion?.startsWith("24")) await api("PATCH", `/v9/projects/${project.id}`, { nodeVersion: "24.x" });
      console.log("  variables set; deploying the site ...");
      if (project.link?.type !== "github" || !project.link.repoId) throw new Error("the project is not connected to GitHub: redeploy it in the dashboard");
      const dep = await api<{ id: string; url: string }>("POST", "/v13/deployments", {
        name: project.name,
        project: project.id,
        target: "production",
        gitSource: { type: "github", repoId: project.link.repoId, ref: project.link.productionBranch ?? "main" },
      });
      const t0 = Date.now();
      let state = "QUEUED";
      while (!["READY", "ERROR", "CANCELED"].includes(state) && Date.now() - t0 < 15 * 60_000) {
        await new Promise((r) => setTimeout(r, 5000));
        state = (await api<{ readyState: string }>("GET", `/v13/deployments/${dep.id}`)).readyState;
      }
      console.log(`  deployment   ${state} after ${Math.round((Date.now() - t0) / 1000)} s (https://${dep.url})`);
      if (state !== "READY") failed = true;
    }
  } catch (err) {
    failed = true;
    console.log(`  ✗ ${String((err as Error).message ?? err)}`);
  }
}

// ---------------------------------------------------------------- Railway
console.log("\nRailway (indexer)");
const service = e.RAILWAY_SERVICE || "@lotz/indexer";
const railway = (args: string[], quiet = false) =>
  spawnSync("railway", args, { cwd: repoRoot(), encoding: "utf8", stdio: quiet ? "ignore" : ["ignore", "pipe", "pipe"] });
const status = railway(["status", "--json"]);
if (status.status !== 0) {
  console.log("  this folder is not linked to a Railway project: railway link --project <name> --service @lotz/indexer");
} else {
  const info = JSON.parse(status.stdout) as { name?: string; services?: { edges?: { node: { name: string } }[] } };
  const names = info.services?.edges?.map((x) => x.node.name) ?? [];
  console.log(`  project      ${info.name ?? "?"}, services: ${names.join(", ") || "none"}`);
  if (!names.includes(service)) {
    console.log(`  ✗ no service "${service}" (set RAILWAY_SERVICE in .env.mainnet to the right name)`);
    failed = true;
  } else {
    console.log(`  set          ${Object.keys(indexer).sort().join(", ")}`);
    console.log(`  domain       ${live ?? "(SITE_DOMAIN is empty)"}`);
    if (apply) {
      const sets = Object.entries(indexer).flatMap(([k, v]) => ["--set", `${k}=${v}`]);
      const r = railway(["variables", "--service", service, ...sets], true);
      if (r.status !== 0) {
        failed = true;
        console.log("  ✗ setting the variables failed");
      } else console.log("  variables set; Railway redeploys the indexer by itself");
      if (live) {
        const d = railway(["domain", live, "--service", service, "--json"]);
        const out = `${d.stdout ?? ""}${d.stderr ?? ""}`.trim();
        console.log(`  domain       ${d.status === 0 ? "added" : "not added"}: ${out.slice(0, 800)}`);
      }
    }
  }
}

console.log(apply ? (failed ? "\nSomething failed (above)." : "\nDone.") : "\nPlan only. Run with --apply to do it.");
process.exit(failed ? 1 : 0);

