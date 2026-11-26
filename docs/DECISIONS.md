# Decisions made while building

Choices the brief left open, or where I deviated from it, and why. Questions that need the owner are in
[QUESTIONS.md](QUESTIONS.md).

## Program

| # | Decision | Why |
|---|---|---|
| P1 | **Shards store `ad_id: u64` per lot, not the ad's `Pubkey`.** A lot is 16 bytes (`ad_id`, `last_price`) instead of 40. | Rent for 100 shards drops from ~2.9 SOL to ~1.2 SOL, paid once by the owner. A prior ad is still verified: it must be owned by the program, carry the `Ad` discriminator and have the matching `ad_id` (ids are unique and never reused). |
| P2 | **Ad PDA is `["ad", buyer, nonce]`, not `["ad", ad_id]`.** `ad_id` stays a sequential number from `Config.next_ad_id`, stored in the ad. | With `["ad", ad_id]` two buyers who fetch the same `next_ad_id` collide: every `buy` write-locks the config, so the second one always fails. The nonce is random per purchase. |
| P3 | **`buy` takes an `epoch` argument: the current epoch or the next one.** | The lock epoch account is a PDA by epoch index; a transaction signed seconds before a weekly boundary would otherwise fail. Choosing the next epoch only locks a few seconds longer, never shorter. |
| P4 | **`lock_period` (365 d), `epoch_len` (7 d) and `takeover_mult_bps` (1.5x) are constants in code**, still written into `Config` so clients read them from chain. | Brief §12 marks them as fixed; making them launch parameters would only add ways to get them wrong. |
| P5 | **`initialize` can only be called by the program's upgrade authority.** | Nobody can front-run the owner between deploy and init with their own mint or treasury. |
| P6 | **The mint is checked in `initialize` and again in every `buy`.** Refused: a freeze authority, a mint close authority, and any Token-2022 extension outside an allowlist (metadata, group, interest-bearing, scaled-UI, and the close-authority extension only with no authority). Refused examples: permanent delegate, transfer fee, transfer hook, default-frozen, pausable, non-transferable, confidential. | Each refused feature lets someone move, tax, freeze or block tokens in the lock vault. A closable mint was the one real hole the security review found: closed at zero supply, it could be re-created at the same address with a permanent delegate and drain the lock. Re-checking in `buy` stops new deposits if a mint ever changes. |
| P7 | `initialize` also checks that the highest tier price times 100 lots fits in u64, and bounds `tier_size >= 100`, `tier_mult` in 1.0x..3.0x, `max_rect` in 1..10. | Overflow would brick purchases late in the board's life. |
| P8 | **The `Ad` account is sized to its strings** (not to the 200/200/64 maximums). | Lower rent for buyers; `close_ad` returns it anyway. |
| P9 | Content checked on-chain: link `https://` + printable ASCII, <= 200 bytes; image URI printable ASCII 1..200 bytes; title <= 64 characters (not bytes), no control characters; image hash not all-zero. | Brief §2.2. ASCII-only links avoid look-alike Unicode in the exit modal; IDN domains work in punycode. |
| P10 | Events are emitted with `emit!` (program logs), not `emit_cpi!`. | `emit_cpi!` needs more accounts and compute per purchase. A buyer could fill the 10 KB log buffer with another instruction and hide our event; the indexer then sees `Log truncated` and rebuilds state from the accounts, so only that purchase's history line (takeover counts) can be lost, never ownership or money. |
| P11 | `LotsBought` carries the full content (image hash, URI, link, title) and the list of prior ads hit. | The indexer can rebuild history from events alone. |
| P12 | Extra fields: `Config.takeovers`, `Config.token_program`, `Ad.paid_total`, `Ad.nonce`. | Counters for the header and `/me` without scanning history. |
| P13 | Price tiers are computed by repeated multiplication with flooring at each step (`p = p * mult / 10000`). | Deterministic and identical in the TypeScript mirror. Tier 9 is 7.4505x, not the exact 7.4506x. |
| P14 | `claim_refund` and `release_epoch` create the destination ATA if it is missing (`init_if_needed`). | A closed ATA must not block a refund or the crank. Caveat: a classic SPL Token ATA whose owner was reassigned with `SetAuthority` blocks this until its holder closes it; only the account's own owner can cause that. |
| P15 | No admin rotation and no way to change the treasury. | Brief: treasury fixed at init. The admin can only pause buying, so rotation adds risk without value. See QUESTIONS Q4. |
| P16 | **The treasury must be a wallet**: an account owned by the System program (a normal wallet, or a multisig vault such as Squads'). | It can never be changed; a token account or a program's PDA as treasury would make every release unrecoverable. |
| P18 | **Retiring the board.** Admin only, after pausing: `retire` (irreversible), then anyone may pay out owed refunds (`claim_refund`) and close any ad (`close_ad`, rent to its owner); the admin closes released epoch records, the shards (`retire_shards`, each checked to be the shard PDA it claims) and, once `ads_open` and `shards_open` are zero, the empty vaults and the config (`retire_config`); then the upgrade authority closes the program. Rent comes back to the admin; owners get theirs first. No instruction moves a locked token early: if the board retires before every epoch is released, those tokens stay in the lock vault for good. A vault that is not empty (someone sent tokens to it) stays open rather than blocking the config. | Owner's request: be able to close Lotz and get the SOL back. Costs +41 KB of program (+0.29 SOL rent, also returned). Keeping the upgrade authority is required to close the program; the site shows `upgradeable`. |
| P17 | `buy` refuses a released epoch; lifetime statistics (`takeovers`, `total_locked`, `total_released`) saturate instead of failing. | Hardening from the review: statistics must never be able to block purchases. |

## Tests

- All scenarios from brief §3.4 run in **LiteSVM** (`cargo test -p lotz`), because unlocking needs the clock moved by a
  year. `anchor test --validator legacy` runs those plus a smoke suite on a real `solana-test-validator`.
- Anchor 1.2 runs Surfpool by default; `--validator legacy` uses `solana-test-validator`. Root script: `pnpm test:anchor`.
- The local validator uses ports 18899/18900/19900 because another project's validator holds the defaults on this machine.

## Measured costs (LiteSVM)

| Instruction | Compute units |
|---|---|
| buy 1 free lot | ~36k |
| buy 100 free lots | ~38k |
| buy 100 lots taking from 16 ads over 4 shards, short content | ~84k (SPL), ~94k (Token-2022) |
| the same with the longest content everywhere (200-byte URI and link, 64-emoji title, also on the 16 prior ads) | ~143k (SPL), ~148k (Token-2022) |
| claim_refund | ~17k |
| close_ad | ~3k |
| release_epoch | ~36-45k (more when it creates the treasury ATA) |

The site sets each purchase's compute limit from a simulation (+15%); without one it uses
`60k + 400/lot + 7k/prior ad + 25k`.

Transaction size: the worst-case `buy` (16 prior ads, 4 shards) fits in 1232 bytes with the lookup table and
short content. With long links and titles fewer prior ads fit (each prior ad is 32 bytes; the content itself can be
~700 bytes); the site detects this before signing and asks for a shorter link/title or fewer taken lots.

## Backend

| # | Decision | Why |
|---|---|---|
| B1 | **The indexer is a separate Node process; the API lives in Next.js route handlers.** They meet in Postgres. The indexer also serves the browsers' live stream (`/stream`, SSE) itself; the web app's `/api/stream` (Postgres `LISTEN`) remains for long-running hosts. | One long-running process owns the chain subscription, the renderer and the open connections, so the web app is stateless and runs on Vercel, where functions cannot hold a connection open. |
| B2 | Chain intake: websocket `logsSubscribe` (fast), `getSignaturesForAddress` polling every 15 s (catches anything missed; it pages back until it meets signatures already processed), and an optional Helius webhook that only supplies signatures. | The poll is the source of truth; the socket and webhook only make it faster. `until`-based cursors failed on the local validator, so processed signatures are kept in a table. |
| B3 | Events are applied in order to an in-memory mirror and the database; a full reconciliation from accounts (config, 100 shards, all ads, epochs) runs at start, every minute for shards/config and every 15 minutes in full. | A missed or reordered event can never leave ownership or prices wrong for long. Lot history (takeover counts) comes from events. |
| B4 | The renderer keeps the board at 4x (4000×4000 RGBA, 64 MB) in memory and republishes only changed 1000×1000 tiles plus 1x and 2x images, under versioned keys. | Fast updates after each purchase; immutable, cacheable URLs. Old versions are deleted after 200 newer files. |
| B5 | Images are verified by fetching `image_uri` and comparing sha256 with the on-chain hash; a mismatch hides the ad. Images not on our storage are fetched with an SSRF guard (https only, public IPs only, pinned to the checked address, no redirects, 2 MB, 10 s) and re-encoded into our storage. Browsers only ever load our copy. | `image_uri` is arbitrary on-chain data. |
| B6 | Unverified images (pending, mismatch, unreadable) are drawn with the hidden pattern. | Never show an image we have not checked. |
| B7 | Uploads are re-encoded as WebP (lossless for PNG input, quality 90 otherwise), flattened onto white, EXIF-rotated and stripped. | A fully transparent image would look like free lots. |
| B8 | The browser talks to the RPC through `/api/rpc` with a method allowlist (no `getProgramAccounts`); `NEXT_PUBLIC_RPC_URL` can override it. Confirmations are polled. | Keeps the Helius key on the server. |
| B9 | Admin sign-in: the server signs an expiring nonce into a message; the wallet signs it; the session is an HMAC-signed HttpOnly SameSite=Strict cookie; mutating admin calls also need an `x-lotz-admin` header. Admins are `ADMIN_WALLET` (comma-separated). | No passwords; CSRF-safe. |
| B10 | Blocking a domain hides its ads and those of its subdomains, now and on arrival; unblocking unhides only ads hidden for that reason. An ad whose image failed the hash check cannot be unhidden. | Brief §2.8. |
| B11 | **Automatic adult-content screening with a local model** (nsfwjs MobileNetV2Mid on TensorFlow.js, WebAssembly backend, ~25 ms per image; plain JS fallback). The upload endpoint refuses a flagged image before anyone pays; the indexer screens every new ad image once (images hosted elsewhere never pass our upload) and hides it with reason `nsfw`. A moderator's unhide sticks, because an image is screened only once. Thresholds: porn+hentai ≥ 0.6 or sexy ≥ 0.9 (`NSFW_EXPLICIT`, `NSFW_SUGGESTIVE`; `NSFW_FILTER=off`). Images longer than 2:1 are checked as 2:1 pieces covering the whole image. | Owner's choice (local model, no outside service). If the check itself fails, the image is allowed and the indexer checks again; moderators remain the last word. |
| B12 | Upload rate limit is counted in Postgres (`rate_limits`, 60 per hour per address) as well as in memory. | On Vercel every function instance has its own memory, so an in-memory limit alone is per instance. |
| B14 | **Share of the supply in the lock** = tokens in the lock now (`total_locked − total_released`, which equals the lock vault balance) ÷ the mint's current total supply, truncated (never rounded up). The indexer reads the supply every minute; the site shows it under "In the lock now"; `GET /api/lock` serves it as JSON (CORS open) with a 1200×675 card at `share/lock.png`, redrawn when the numbers or the date change; `pnpm --filter @lotz/ops lock-stats` reads it straight from the chain with a ready post. Refund-vault tokens are not counted: they belong to previous owners. | Owner's request: a figure to post. Total supply, not "circulating", because only the mint's figure can be checked by anyone. |
| B13 | On Vercel the web app's database pool is small (5 connections, 5 s idle) and attached with `attachDatabasePool`; `DATABASE_URL` there is the provider's pooled endpoint. The indexer uses a direct connection (it needs `LISTEN`). | Serverless instances come and go; a transaction pooler keeps the connection count bounded. |

## Site

| # | Decision | Why |
|---|---|---|
| S1 | The page grid is a CSS background on `body`; the board sets `--grid-x/--grid-y` so its frame sits exactly on grid lines. The effects canvas (flashes, eyes, blinks) draws in the same document grid. | Brief §7.1: the board is a piece of the endless grid, no seam. |
| S2 | Board rendering: 1x image up to 1.25 device px per logical px, 2x up to 2.5, then 4x tiles of the visible area; lot grid drawn under the image below 2x zoom and over it from 2x. | Sharp at every zoom without loading 16 MB at once. |
| S3 | Wheel zooms in to the cursor; zooming out stops at the full board and then the wheel scrolls the page. On touch, one finger scrolls the page at full view and pans when zoomed; two fingers pinch. In buy mode one finger selects. | The board must not trap page scrolling. |
| S4 | The buy panel quotes from the indexed board instantly, then re-quotes from the on-chain shards every 10 s and again right before signing; `max_total` = that fresh total. | Brief §3.2 `max_total`; no surprise price. |
| S5 | Eyes appear only when the margins are wide enough (≥ 1500 px wide window), at their original cell size on the 10 px grid; two left, one right, at different heights. Purchase rays reach ~45% of the screen, takeover rays reach the edge with a bigger star and two-cell-thick rays. | Brief §7.2–7.3. |
| S6 | The Lock section says plainly that the program is upgradeable while it is, and who the authority is. No promise about removing it. | Brief §11. |
| S7 | Demo data uses abstract generated images and neutral titles ("your coin …") with example.com links. | Brief §11: no invented tickers. |
