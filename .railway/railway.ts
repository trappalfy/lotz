// Railway runs only the indexer; the site is on Vercel. Variables are not managed here (no secrets in the
// repository): `pnpm --filter @lotz/ops hosting --apply` sets them from .env.mainnet.
//   railway config plan     # preview
//   railway config apply    # apply (anything left out of this file is removed from the project)
import { defineRailway, github, project, service } from "railway/iac";

export default defineRailway(() => {
  const lotz = github("trappalfy/lotz", { branch: "main", checkSuites: false });

  const indexer = service("@lotz/indexer", {
    source: lotz,
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "apps/indexer/Dockerfile",
      watchPatterns: ["/apps/indexer/**", "/packages/**", "/package.json", "/pnpm-lock.yaml", "/pnpm-workspace.yaml"],
    },
    start: "pnpm --filter @lotz/indexer start",
    healthcheck: "/health",
    healthcheckTimeout: 300,
    // one instance only (two would index the same transactions), next to the database (Neon, AWS us-east-1)
    replicas: { "us-east": 1 },
    // live.lotz.fun was added with `railway domain` (configuration cannot register a domain); listed so apply keeps it
    networking: { privateNetworkEndpoint: "lotzindexer", customDomains: { "live.lotz.fun": {} } },
  });

  return project("triumphant-benevolence", {
    variables: { managed: false },
    resources: [indexer],
  });
});
