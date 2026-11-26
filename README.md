# Lotz

A 1000×1000 pixel board on Solana, sold as 10,000 lots of 10×10 px. Lots are paid in one token; a taken lot costs
1.5x its last price and the previous owner gets back everything they paid; the rest is locked for a year.
The product brief is [LOTZ-SITE-BRIEF.md](LOTZ-SITE-BRIEF.md).

## What is here

| Path | What |
|---|---|
| [programs/lotz](programs/lotz) | The Anchor program (Rust, Anchor 1.2.2, SPL Token and Token-2022) and its LiteSVM tests |
| [packages/sdk](packages/sdk) | IDL, addresses, the exact price math in TypeScript, instruction builders, event parsing |
| [packages/db](packages/db) | Postgres schema (SQL migrations) and queries |
| [packages/storage](packages/storage) | Object storage: a local folder in development, R2/S3 in production |
| [packages/imaging](packages/imaging) | Image checks, crop and resize to `w×40 × h×40`, sha256, SSRF-safe fetching |
| [packages/moderation](packages/moderation) | Automatic adult-content screening of ad images with a local model (nsfwjs on TensorFlow.js WebAssembly) |
| [packages/brand](packages/brand) | Star and eyes as cell matrices; eye/pupil analysis |
| [apps/indexer](apps/indexer) | Listens to the program, keeps Postgres in sync, verifies and screens images, renders the board and OG card, serves the live stream |
| [apps/web](apps/web) | Next.js site and API (runs on Vercel): board, purchase, `/me`, `/admin`, upload, RPC proxy |
| [packages/local](packages/local) | Local validator setup and demo data (refuses non-local RPCs) |
| [packages/ops](packages/ops) | Owner tools for a real cluster: launch and wind-down (dry runs by default), pause, import a key, check settings, lock stats |
| [tests/localnet](tests/localnet) | Smoke tests on a real `solana-test-validator` (run by `anchor test`) |
| [docs](docs) | [DECISIONS.md](docs/DECISIONS.md), [QUESTIONS.md](docs/QUESTIONS.md), [DEPLOY.md](docs/DEPLOY.md) |

## Run it locally

Needs Rust, Solana CLI and Anchor 1.2.2, Node 22+, pnpm, Postgres.

```sh
pnpm install
anchor build && pnpm idl          # program + IDL copied into the SDK
pnpm localnet -- --seed           # validator on :18899, test token, initialize, shards, lookup table, .env, demo ads
# in two more terminals:
pnpm --filter @lotz/indexer start # indexer (migrates the database on start)
pnpm --filter @lotz/web dev       # http://localhost:3000
```

`pnpm localnet` keeps the validator running until Ctrl+C. `pnpm localnet -- --reset` wipes the local ledger,
database and storage first. `pnpm localnet:fund <wallet> [tokens]` sends SOL and test tokens to a wallet
(Solflare and Backpack can point at `http://127.0.0.1:18899` as a custom RPC).

`.env` lives at the repository root (`apps/web/.env` is a symlink to it). See [.env.example](.env.example).
The local Postgres here listens on 5433; `DATABASE_URL` in `.env` says where yours is.

## Tests

```sh
cargo test -p lotz                     # program: every scenario of brief §3.4, LiteSVM, ~20 s
pnpm test:anchor                       # the above + smoke tests on solana-test-validator (anchor test --validator legacy)
pnpm --filter @lotz/sdk test           # price math mirrors the program, encoders, event parsing
pnpm --filter @lotz/db test            # schema and queries (database lotz_test)
pnpm --filter @lotz/imaging test       # image pipeline, SSRF guard
pnpm --filter @lotz/moderation test    # image screening: thresholds, regions, the model on the WebAssembly backend
pnpm --filter @lotz/indexer test       # end to end on its own validator: events -> database -> render -> stream
pnpm --filter @lotz/ops test           # key import, dollar price, mainnet settings
pnpm --filter @lotz/web e2e            # browser: connect, select, upload, pay, takeover, claim, moderation, background
```

The web end-to-end tests need the local stack running (see above). They sign with a test wallet that the tests
inject through the Wallet Standard, so no browser extension is needed.

## How it fits together

```
 browser ──/api/rpc──▶ RPC (key stays on the server)              program (on-chain)
    │  ▲                                                              │ logs + accounts
    │  └──────────── indexer /stream (SSE) ◀── indexer ◀──────────────┘ (websocket, polling, Helius webhook)
    │                                            │  ▲
    └──/api/board, /api/stats, … ──▶ Postgres ◀──┘  └── NOTIFY on moderation changes from /admin
                                         storage (R2/S3): uploaded images, board renders, OG card
```

The site (`apps/web`) only answers short requests, so it runs on Vercel; the indexer is one long-running process
on any container host, and browsers get live updates from it directly (`STREAM_URL`).

- The program is the source of truth. The indexer applies events in order and reconciles from account state
  (shards, ads, epochs) at start and every few minutes, so a missed event cannot leave the board wrong.
- The board is rendered server-side at 4x (4000×4000) and published as 1x/2x images and 16 tiles; the site
  draws the right resolution for the zoom level.
- A purchase is quoted again from the shards on-chain right before signing, and `max_total` is set to that quote,
  so a price change between quote and signature fails the transaction instead of overcharging.
