import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { before, after, beforeEach, afterEach, test } from "node:test";
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { asc, eq, inArray } from "drizzle-orm";
import { createApp } from "../src/app.js";
import { mysqlConfig } from "../src/db/config.js";
import { mysqlPool } from "../src/db/mysql.js";
import { dogs, dogImages } from "../src/db/schema.ts";
import { demoDogs, insertDemoDogs } from "../src/db/seed-dogs.js";

let connection;
let database;
let server;
let origin;
let initialCounts;

async function counts() {
  const [[row]] = await connection.query(
    "SELECT (SELECT COUNT(*) FROM dogs) AS dogs, (SELECT COUNT(*) FROM dog_images) AS images"
  );
  return row;
}

before(async () => {
  connection = await mysql.createConnection(mysqlConfig);
  database = drizzle(connection);
  initialCounts = await counts();
  server = createApp({ database, jwtSecret: randomBytes(32).toString("hex") }).listen(0, "127.0.0.1");
  await once(server, "listening");
  origin = "http://127.0.0.1:" + server.address().port;
});
beforeEach(async () => { await connection.beginTransaction(); });
afterEach(async () => { await connection.rollback(); });
after(async () => {
  if (server?.listening) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  try {
    if (connection) {
      await connection.rollback();
      assert.deepEqual(await counts(), initialCounts, "Dog tests must not leave rows behind.");
    }
  } finally {
    await connection?.end();
    await mysqlPool.end();
  }
});

async function list(query = "") {
  const response = await fetch(origin + "/dogs" + query);
  return { status: response.status, body: await response.json() };
}

async function fixtures() {
  const suffix = randomUUID().slice(0, 8);
  const shared = { gender: "male", description: "Temporary integration fixture.", isAdopted: false };
  const rows = [
    { ...shared, id: randomUUID(), name: "000 Alpha " + suffix, breed: "Corgi", age: 10, weight: 2.5, isNeutered: true },
    { ...shared, id: randomUUID(), name: "000 Bravo " + suffix, breed: "Beagle", age: 2, weight: 12.75, isNeutered: false },
    { ...shared, id: randomUUID(), name: "000 Alpha " + suffix, breed: "Husky", age: 0.8, weight: 9.25, isNeutered: true },
    { ...shared, id: randomUUID(), name: "000 Adopted " + suffix, breed: "Pug", age: 4, weight: 8, isNeutered: true, isAdopted: true },
  ];
  await database.insert(dogs).values(rows);
  const images = [
    { id: randomUUID(), dogId: rows[0].id, position: 1, url: "https://example.invalid/extra.jpg", fileName: "extra.jpg", size: 1, type: "image/jpeg" },
    { id: randomUUID(), dogId: rows[0].id, position: 0, url: "/demo-dogs/luna.jpg", fileName: "luna.jpg", size: 83946, type: "image/jpeg" },
  ];
  await database.insert(dogImages).values(images);
  return { rows, images };
}

test("listing returns the frontend contract, numeric values, booleans and ordered images without MongoDB", async () => {
  const { rows, images } = await fixtures();
  const response = await list();
  assert.equal(response.status, 200);
  assert.ok(Array.isArray(response.body));
  const dog = response.body.find((row) => row._id === rows[0].id);
  assert.deepEqual(Object.keys(dog).sort(), [
    "_id", "age", "breed", "description", "gender", "images", "isAdopted", "isNeutered", "location", "name", "weight",
  ]);
  assert.equal(dog.age, 10);
  assert.equal(dog.weight, 2.5);
  assert.equal(dog.isNeutered, true);
  assert.equal(dog.isAdopted, false);
  assert.equal(dog.location, null);
  assert.deepEqual(dog.images.map((image) => image._id), [images[1].id, images[0].id]);
  assert.equal(dog.images[0].url, origin + "/demo-dogs/luna.jpg");
  assert.equal(dog.images[1].url, "https://example.invalid/extra.jpg");
  assert.deepEqual(Object.keys(dog.images[0]).sort(), ["_id", "fileName", "size", "type", "url"]);
  assert.deepEqual(response.body.find((row) => row._id === rows[2].id).images, []);
  assert.ok(!response.body.some((row) => row._id === rows[3].id));
  assert.ok(response.body.every((row) => row.isAdopted === false));
});

test("all four sorting options support both directions and numeric rather than string order", async () => {
  const { rows } = await fixtures();
  const available = rows.filter((row) => !row.isAdopted);
  const ids = new Set(available.map((row) => row.id));
  for (const sort of ["name", "breed", "age", "weight"]) {
    for (const order of ["asc", "desc"]) {
      const response = await list("?sort=" + sort + "&order=" + order);
      assert.equal(response.status, 200);
      const actual = response.body.filter((row) => ids.has(row._id)).map((row) => row._id);
      const expected = [...available].sort((a, b) => {
        const primary = typeof a[sort] === "number" ? a[sort] - b[sort] : a[sort].localeCompare(b[sort]);
        return primary ? primary * (order === "asc" ? 1 : -1) : a.id.localeCompare(b.id);
      }).map((row) => row.id);
      assert.deepEqual(actual, expected, sort + " " + order);
    }
  }
});

test("neutered filtering keeps adopted dogs out and returns actual JSON booleans", async () => {
  const { rows } = await fixtures();
  const fixtureIds = new Set(rows.map((row) => row.id));
  for (const filter of [true, false]) {
    const response = await list("?isNeutered=" + filter);
    assert.equal(response.status, 200);
    assert.ok(response.body.every((dog) => dog.isNeutered === filter && dog.isAdopted === false));
    assert.deepEqual(
      response.body.filter((dog) => fixtureIds.has(dog._id)).map((dog) => dog._id).sort(),
      rows.filter((dog) => dog.isNeutered === filter && !dog.isAdopted).map((dog) => dog.id).sort()
    );
  }
});

test("pagination counts dogs rather than joined image rows and an empty result is an array", async () => {
  await fixtures();
  const expected = await database.select({ _id: dogs.id }).from(dogs)
    .where(eq(dogs.isAdopted, false)).orderBy(asc(dogs.name), asc(dogs.id)).limit(3);
  const first = await list("?limit=2");
  const second = await list("?limit=1&offset=2");
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.deepEqual([...first.body, ...second.body].map((dog) => dog._id), expected.map((dog) => dog._id));
  const [[row]] = await connection.query("SELECT COUNT(*) AS total FROM dogs WHERE is_adopted = 0");
  const empty = await list("?offset=" + row.total);
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.body, []);
});

test("unsupported, repeated, nested and injection-like query parameters return 400", async () => {
  for (const query of [
    "?sort=description", "?sort=__proto__", "?sort=constructor", "?sort=",
    "?sort=name%20DESC%3B%20DROP%20TABLE%20dogs", "?sort=name&sort=age", "?sort[field]=name",
    "?order=sideways", "?isNeutered=1", "?isNeutered=true&isNeutered=false",
    "?limit=0", "?limit=101", "?limit=1.5", "?limit=abc",
    "?offset=-1", "?offset=1.5", "?offset=100001", "?isAdopted=true", "?unknown=value",
  ]) {
    const response = await list(query);
    assert.equal(response.status, 400, query);
    assert.equal(typeof response.body.message, "string");
  }
  assert.deepEqual(await counts(), initialCounts);
});

test("dog images enforce ownership and ordering and are removed with their dog", async () => {
  const { rows, images } = await fixtures();
  const code = (expected) => (error) => (error.cause?.code || error.code) === expected;
  await assert.rejects(database.insert(dogImages).values({
    ...images[0], id: randomUUID(), dogId: randomUUID(),
  }), code("ER_NO_REFERENCED_ROW_2"));
  await assert.rejects(database.insert(dogImages).values({
    ...images[0], id: randomUUID(),
  }), code("ER_DUP_ENTRY"));
  await assert.rejects(
    connection.execute("UPDATE dogs SET weight = 0 WHERE id = ?", [rows[0].id]),
    code("ER_CHECK_CONSTRAINT_VIOLATED")
  );
  await assert.rejects(
    connection.execute("UPDATE dogs SET age = -1 WHERE id = ?", [rows[0].id]),
    code("ER_CHECK_CONSTRAINT_VIOLATED")
  );
  await assert.rejects(
    connection.execute("UPDATE dogs SET is_neutered = 2 WHERE id = ?", [rows[0].id]),
    code("ER_CHECK_CONSTRAINT_VIOLATED")
  );
  await database.delete(dogs).where(eq(dogs.id, rows[0].id));
  assert.deepEqual(await database.select().from(dogImages).where(eq(dogImages.dogId, rows[0].id)), []);
});

test("demo seeding is repeatable, preserves edited records and supplies working local photos", async () => {
  // Use fresh IDs so neither test runs nor rollbacks touch the user's demo records.
  const records = demoDogs.map((dog) => ({ ...dog, id: randomUUID(), imageId: randomUUID() }));
  const ids = records.map((dog) => dog.id);
  await insertDemoDogs(database, records);
  const seeded = await database.select().from(dogs).where(inArray(dogs.id, ids));
  assert.equal(seeded.length, records.length);
  await database.update(dogs).set({ description: "Keep my edits.", isAdopted: true }).where(eq(dogs.id, records[0].id));
  await database.update(dogImages).set({ url: "/demo-dogs/rocky.jpg" }).where(eq(dogImages.id, records[0].imageId));
  const beforeDogs = await database.select().from(dogs).where(inArray(dogs.id, ids)).orderBy(asc(dogs.id));
  const beforeImages = await database.select().from(dogImages).where(inArray(dogImages.dogId, ids)).orderBy(asc(dogImages.id));
  await insertDemoDogs(database, records);
  assert.deepEqual(await database.select().from(dogs).where(inArray(dogs.id, ids)).orderBy(asc(dogs.id)), beforeDogs);
  assert.deepEqual(await database.select().from(dogImages).where(inArray(dogImages.dogId, ids)).orderBy(asc(dogImages.id)), beforeImages);

  const listed = await list();
  const milo = listed.body.find((dog) => dog._id === records[1].id);
  assert.equal(milo.age, 0.8);
  assert.equal(milo.weight, 8.25);
  assert.equal(milo.isNeutered, false);
  for (const record of records) {
    const response = await fetch(origin + "/demo-dogs/" + record.imageFile);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /^image\/jpeg/);
    const bytes = new Uint8Array(await response.arrayBuffer());
    assert.equal(bytes[0], 255);
    assert.equal(bytes[1], 216);
    assert.ok(bytes.length > 1000);
  }
});

test("database errors produce a generic 500 rather than an empty dog list", async (t) => {
  const log = t.mock.method(console, "error", () => {});
  const failingDb = {
    select() {
      throw Object.assign(new Error("Private SQL details."), { code: "DOG_DB_FAILURE" });
    },
  };
  const failingServer = createApp({ database: failingDb, jwtSecret: randomBytes(32).toString("hex") })
    .listen(0, "127.0.0.1");
  await once(failingServer, "listening");
  t.after(async () => {
    failingServer.closeAllConnections();
    await new Promise((resolve) => failingServer.close(resolve));
  });
  const response = await fetch("http://127.0.0.1:" + failingServer.address().port + "/dogs");
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { message: "An unexpected error occurred." });
  assert.deepEqual(log.mock.calls[0].arguments, ["Request failed:", "DOG_DB_FAILURE"]);
});

test("dog management and individual lookup remain unavailable until their migration", async () => {
  for (const [method, path] of [["POST", "/dogs"], ["GET", "/dogs/" + randomUUID()]]) {
    const response = await fetch(origin + path, { method });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { message: "This feature is temporarily unavailable." });
  }
});
