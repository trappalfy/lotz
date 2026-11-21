/** `pnpm --filter @lotz/ops pause true|false` (admin only; asks before sending). */
import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { LotzInstructions } from "@lotz/sdk";
import { confirmTyped, keypair, need, send } from "./common";

const value = process.argv[2];
if (value !== "true" && value !== "false") {
  console.error("usage: pause true|false");
  process.exit(1);
}
const connection = new Connection(need("RPC_URL"), "confirmed");
const mint = new PublicKey(need("TOKEN_MINT"));
const owner = (await connection.getAccountInfo(mint))?.owner;
const ixs = new LotzInstructions({
  programId: new PublicKey(need("PROGRAM_ID")),
  mint,
  tokenProgram: owner?.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID,
  treasury: new PublicKey(need("TREASURY")),
});
const admin = keypair(need("ADMIN_KEYPAIR"));
if (!(await confirmTyped(value === "true" ? "PAUSE" : "RESUME", `set_paused(${value}) on ${need("RPC_URL")}`))) process.exit(1);
console.log(await send(connection, admin, [ixs.setPaused(admin.publicKey, value === "true")], Number(process.env.PRIORITY_FEE_MICROLAMPORTS ?? "10000")));
