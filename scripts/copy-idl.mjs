// Copies the IDL and its TS type from `anchor build` into the SDK, so the apps never read target/.
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "packages/sdk/src/idl");
copyFileSync(join(root, "target/idl/lotz.json"), join(out, "lotz.json"));
const types = readFileSync(join(root, "target/types/lotz.ts"), "utf8");
writeFileSync(join(out, "lotz.ts"), types);
console.log("IDL copied to packages/sdk/src/idl");
