import type { NextConfig } from "next";

// The web app reads the repository's root .env through the symlink apps/web/.env (made by `pnpm localnet`).

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ["@lotz/sdk", "@lotz/brand", "@lotz/db", "@lotz/storage", "@lotz/imaging", "@lotz/moderation"],
  serverExternalPackages: ["sharp", "pg", "@tensorflow/tfjs", "@tensorflow/tfjs-backend-wasm", "nsfwjs"],
  turbopack: {
    resolveAlias: {
      fs: { browser: "./empty.ts" },
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
        ],
      },
    ];
  },
};

export default config;
