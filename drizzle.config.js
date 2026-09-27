import "dotenv/config";
import { defineConfig } from "drizzle-kit";
import { mysqlConfig } from "./src/db/config.js";

export default defineConfig({
  dialect: "mysql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: mysqlConfig,
});
