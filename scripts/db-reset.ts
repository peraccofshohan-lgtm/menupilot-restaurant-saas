import { rm } from "node:fs/promises";
import path from "node:path";

const dir = process.env.DATABASE_PGLITE_DIR || path.join(process.cwd(), ".data", "pglite");
await rm(dir, { recursive: true, force: true });
console.log(`removed ${dir}`);
