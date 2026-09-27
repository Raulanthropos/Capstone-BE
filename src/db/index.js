import { drizzle } from "drizzle-orm/mysql2";
import { mysqlPool } from "./mysql.js";

export const db = drizzle(mysqlPool);
