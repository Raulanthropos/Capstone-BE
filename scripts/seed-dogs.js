import { db } from "../src/db/index.js";
import { mysqlPool } from "../src/db/mysql.js";
import { insertDemoDogs } from "../src/db/seed-dogs.js";

try {
  if (process.env.NODE_ENV === "production" && !process.argv.includes("--allow-production")) {
    throw Object.assign(new Error("Use --allow-production to explicitly seed a hosted demo database."), { code: "LOCAL_SEED_ONLY" });
  }
  await db.transaction((transaction) => insertDemoDogs(transaction));
  console.log("Demo dog seed completed. Existing records were preserved.");
} catch (error) {
  console.error("Dog seed failed:", error.cause?.code || error.code || error.name);
  process.exitCode = 1;
} finally {
  await mysqlPool.end();
}
