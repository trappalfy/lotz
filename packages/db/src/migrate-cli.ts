import { createPool, migrate } from "./index";

const pool = createPool();
const applied = await migrate(pool);
console.log(applied.length ? `applied: ${applied.join(", ")}` : "up to date");
await pool.end();
