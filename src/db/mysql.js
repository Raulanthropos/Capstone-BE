import mysql from "mysql2/promise";
import { mysqlConfig } from "./config.js";

export const mysqlPool = mysql.createPool({
  ...mysqlConfig,
  connectionLimit: 5,
  connectTimeout: 5000,
});
