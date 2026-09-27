import { randomUUID } from "node:crypto";
import { char, int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  // Drizzle supplies the UUID on insert; raw SQL inserts must supply an ID.
  id: char("id", { length: 36 }).primaryKey().$defaultFn(() => randomUUID()),
  name: varchar("name", { length: 100 }).notNull(),
  surname: varchar("surname", { length: 100 }).notNull(),
  age: int("age", { unsigned: true }).notNull(),
  email: varchar("email", { length: 254 }).notNull().unique(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  picture: text("picture"),
  role: mysqlEnum("role", ["admin", "user"]).notNull().default("user"),
  description: text("description").notNull(),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow().onUpdateNow(),
});
