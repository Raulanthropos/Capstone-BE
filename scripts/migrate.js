import { mysqlConfig } from "../src/db/config.js";
import { migrateDatabase } from "../src/db/migrate.js";

try {
  await migrateDatabase(mysqlConfig);
  console.log("MySQL migrations completed.");
} catch (error) {
  console.error("Migration failed:", error.cause?.code || error.code || error.name);
  process.exitCode = 1;
}
