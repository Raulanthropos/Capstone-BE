import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";

export async function migrateDatabase(config) {
  const connection = await mysql.createConnection({ ...config, connectTimeout: 10000 });
  const lock = "woof-paws:migrate:" + createHash("sha256").update(config.database).digest("hex").slice(0, 32);
  let acquired = false;
  try {
    const [[row]] = await connection.execute("SELECT GET_LOCK(?, 60) AS acquired", [lock]);
    if (row.acquired !== 1) throw Object.assign(new Error("Migration lock unavailable."), { code: "MIGRATION_LOCK_TIMEOUT" });
    acquired = true;
    await migrate(drizzle(connection), {
      migrationsFolder: fileURLToPath(new URL("../../drizzle/", import.meta.url)),
    });
  } finally {
    try { if (acquired) await connection.execute("SELECT RELEASE_LOCK(?)", [lock]); }
    finally { await connection.end(); }
  }
}
