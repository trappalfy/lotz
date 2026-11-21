# Deploying Lotz

Everything that touches mainnet is the owner's call (brief §11). Nothing in this repository sends a mainnet
transaction on its own: the launch script is a dry run unless given `--execute`, and then asks you to type a word.

## 1. Program

1. Decide the program id. Generate a keypair you keep safe, set it in `programs/lotz/src/lib.rs`
   (`declare_id!`) and `Anchor.toml`, then `anchor build && pnpm idl`.
2. Run the full test suite (`pnpm test:anchor`).
3. Deploy with the owner's wallet as upgrade authority:
   ```sh
   solana program deploy target/deploy/lotz.so --program-id <program-keypair.json> \
     --keypair <owner.json> --url <mainnet RPC> --with-compute-unit-price 10000
   ```
4. Launch (initialize, 100 shards, lookup table). First a dry run, which checks the mint, the authority and
   prints the cost:
   ```sh
   RPC_URL=<mainnet RPC> PROGRAM_ID=<id> TOKEN_MINT=<mint> TREASURY=<treasury wallet> \
   ADMIN_KEYPAIR=<owner.json> BASE_PRICE_TOKENS=<tokens per free lot> \
   TIER_SIZE=1000 TIER_MULT_BPS=12500 MAX_RECT=10 START_PAUSED=true \
   pnpm --filter @lotz/ops launch
   ```
   Then the same command with `--execute`. Rent: ~1.2 SOL for the shards, ~0.02 SOL for the lookup table.
   `initialize` refuses a mint with a freeze authority, a mint close authority, or Token-2022 extensions that could
   move or block locked tokens (DECISIONS P6), and a treasury that is not a plain wallet or multisig vault (P16).
5. When the site is up: `pnpm --filter @lotz/ops pause false` to open buying.
6. When the owner decides the program is final, remove the upgrade authority:
   ```sh
   solana program set-upgrade-authority <program id> --final --keypair <owner.json> --url <mainnet RPC>
   ```
   The site shows `immutable` from then on (it reads the ProgramData account).

## 2. Services

| Service | Notes |
|---|---|
| Postgres | Any managed Postgres 14+. The indexer runs migrations on start. |
| Object storage | Cloudflare R2 (or S3) bucket behind a CDN domain, e.g. `https://cdn.lotz.fun`. Set `STORAGE_DRIVER=s3`, `STORAGE_PUBLIC_URL`, `STORAGE_S3_*`. Uploaded images are content-addressed and immutable; board images are versioned. |
| Indexer | One long-running Node process (`pnpm --filter @lotz/indexer start`). Needs `RPC_URL`, `RPC_WS_URL`, `PROGRAM_ID`, `DATABASE_URL`, `STORAGE_*`. Exposes `/health` and `/webhooks/helius` on `INDEXER_PORT` (bind it behind a reverse proxy if you use the webhook). |
| Web | `pnpm --filter @lotz/web build && pnpm --filter @lotz/web start` on a long-running Node host (the SSE stream holds one Postgres LISTEN connection per process). Put a CDN in front; `/api/board` and `/api/stats` send short `s-maxage` headers. |
| RPC | Helius (or any). The key is only in `RPC_URL` on the server; browsers use `/api/rpc`, which passes a fixed list of methods. |
| Helius webhook (optional) | A "raw" webhook for the program address, to `https://<indexer host>/webhooks/helius` with `Authorization: <HELIUS_WEBHOOK_SECRET>`. The indexer only takes signatures from it and fetches the transactions itself. |

Environment: see [.env.example](../.env.example). Set `NEXT_PUBLIC_CLUSTER=mainnet-beta`, a random
`SESSION_SECRET` (32+ characters), `ADMIN_WALLET` (moderation wallets), `NEXT_PUBLIC_X_URL`,
`NEXT_PUBLIC_SOURCE_URL`, `LOOKUP_TABLE` (printed by the launch script).

## 3. Before opening

- [ ] `pnpm test:anchor`, `pnpm -r test` and `pnpm --filter @lotz/web e2e` (on a local stack) are green.
- [ ] The token mint passes `initialize` (dry run shows no warning).
- [ ] Site on a phone: the board, Buy lots, the panel, `/me`.
- [ ] `prefers-reduced-motion` turns off flashes and blinking.
- [ ] Every ad link opens the exit modal with the domain.
- [ ] The Lock section shows the right addresses and `upgradeable`/`immutable`.
- [ ] Admin sign-in works with the owner's wallet; a test domain block hides and unhides.
