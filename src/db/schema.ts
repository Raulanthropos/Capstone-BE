import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { boolean, char, check, decimal, index, int, mysqlEnum, mysqlTable, smallint, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

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

export const dogs = mysqlTable("dogs", {
  id: char("id", { length: 36 }).primaryKey().$defaultFn(() => randomUUID()),
  // Names are not unique: different dogs can share a name.
  name: varchar("name", { length: 100 }).notNull(),
  breed: varchar("breed", { length: 100 }).notNull(),
  age: decimal("age", { precision: 3, scale: 1, mode: "number" }).notNull(),
  gender: mysqlEnum("gender", ["male", "female"]).notNull(),
  weight: decimal("weight", { precision: 5, scale: 2, mode: "number" }).notNull(),
  location: varchar("location", { length: 255 }),
  description: text("description").notNull(),
  isAdopted: boolean("is_adopted").notNull().default(false),
  isNeutered: boolean("is_neutered").notNull().default(false),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow().onUpdateNow(),
}, (table) => [
  index("dogs_available_name_idx").on(table.isAdopted, table.name, table.id),
  check("dogs_age_nonnegative", sql`${table.age} >= 0`),
  check("dogs_weight_positive", sql`${table.weight} > 0`),
  check("dogs_adopted_boolean", sql`${table.isAdopted} in (0, 1)`),
  check("dogs_neutered_boolean", sql`${table.isNeutered} in (0, 1)`),
]);

export const dogImages = mysqlTable("dog_images", {
  id: char("id", { length: 36 }).primaryKey().$defaultFn(() => randomUUID()),
  dogId: char("dog_id", { length: 36 }).notNull().references(() => dogs.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  fileName: varchar("file_name", { length: 255 }).notNull(),
  size: int("size", { unsigned: true }).notNull(),
  type: varchar("type", { length: 100 }).notNull(),
  position: smallint("position", { unsigned: true }).notNull().default(0),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("dog_images_dog_position_unique").on(table.dogId, table.position),
]);

export const adoptionRequests = mysqlTable("adoption_requests", {
  id: char("id", { length: 36 }).primaryKey().$defaultFn(() => randomUUID()),
  userId: char("user_id", { length: 36 }).notNull().references(() => users.id, { onDelete: "restrict" }),
  dogId: char("dog_id", { length: 36 }).notNull().references(() => dogs.id, { onDelete: "restrict" }),
  status: mysqlEnum("status", ["pending", "approved", "rejected"]).notNull().default("pending"),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow().onUpdateNow(),
}, (table) => [
  // One application per user/dog pair, including simultaneous submissions.
  uniqueIndex("adoption_requests_user_dog_unique").on(table.userId, table.dogId),
  index("adoption_requests_user_created_idx").on(table.userId, table.createdAt, table.id),
]);
