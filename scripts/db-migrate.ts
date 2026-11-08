import "dotenv/config";
import { getDb } from "../src/lib/db";
import { migrate } from "../src/lib/db/migrate";

const db = await getDb();
const ran = await migrate(db, (m) => console.log(`  ✓ ${m}`));
console.log(ran.length ? `applied ${ran.length} migration(s)` : "already up to date");
await db.close();
