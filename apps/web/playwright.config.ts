import { defineConfig } from "@playwright/test";

/**
 * End-to-end tests against a running local stack:
 *   pnpm localnet --seed    (validator + Lotz + .env)
 *   pnpm --filter @lotz/indexer start
 *   pnpm --filter @lotz/web dev
 */
export default defineConfig({
  testDir: "e2e",
  timeout: 180_000,
  fullyParallel: false,
  workers: 1,
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000", viewport: { width: 1440, height: 1000 } },
  reporter: [["list"]],
});
