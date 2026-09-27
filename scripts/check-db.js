import { mysqlPool } from "../src/db/mysql.js";

try {
  const [rows] = await mysqlPool.query(
    "SELECT VERSION() AS mysql_version, DATABASE() AS current_database"
  );
  console.table(rows);
  console.log("MySQL connection successful.");
} catch (error) {
  console.error(`MySQL connection failed (${error.code || error.name}): ${error.message}`);
  process.exitCode = 1;
} finally {
  await mysqlPool.end();
}
