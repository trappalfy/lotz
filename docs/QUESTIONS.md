# Questions for the owner

I kept working with the defaults below; each one is easy to change. Nothing has touched mainnet.

| # | Question | What I did meanwhile |
|---|---|---|
| Q1 | **Token mint.** SPL Token or Token-2022? Freeze authority or extensions? `initialize` refuses a freeze authority and risky Token-2022 extensions (DECISIONS P6). Run the launch dry run with the real mint to see. | Tested with SPL Token and with Token-2022 + metadata pointer, 6 decimals. |
| Q2 | **`BASE_PRICE`** ("from the token price at launch"). | 1,000 tokens per lot on localnet. |
| Q3 | **Treasury wallet.** Fixed forever at `initialize`; a multisig is a good idea. | A throwaway key on localnet. |
| Q4 | **Admin key** can only pause/resume buying and cannot be changed later. Should it be rotatable? | Not rotatable (P15). The moderation admins (`ADMIN_WALLET`) are separate and can be any wallets. |
| Q5 | **Mainnet program id** (keypair you keep). | Local id `4WieikR7HUJt3FkpLQYTocWa9GS4LUio6tuGeDt1DWap`, keypair gitignored in `target/deploy/`. |
| Q6 | **Rent**: ~1.2 SOL for shards, ~0.02 SOL for the lookup table, paid by the admin at launch. OK? | `pnpm --filter @lotz/ops launch` prints the exact cost in its dry run. |
| Q7 | **X account URL and source-code URL** for the footer and the Lock section. | Read from `NEXT_PUBLIC_X_URL`, `NEXT_PUBLIC_SOURCE_URL`; hidden while empty. |
| Q8 | **Hosting**: where do Postgres, the indexer and the site run, and which R2 bucket / CDN domain? | `docs/DEPLOY.md` covers any Node host + Postgres + R2. |
| Q9 | **Git**: the folder had no repository. I ran `git init` (no commits) so `.gitignore` protects `keys/`, `.env` and `target/`. Commit when you have looked through it. | No commits made. |
| Q10 | **Content rules**: auto-hide only via the domain block list and hash checks; everything else is manual in `/admin`. Want automatic image moderation (e.g. an NSFW classifier) too? | Manual. |
