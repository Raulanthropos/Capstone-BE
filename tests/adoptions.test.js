import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { before, after, beforeEach, afterEach, test } from "node:test";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { desc, eq, inArray } from "drizzle-orm";
import { createApp } from "../src/app.js";
import { createAccessTokens } from "../src/lib/auth/accessTokens.js";
import { db } from "../src/db/index.js";
import { mysqlPool } from "../src/db/mysql.js";
import { adoptionRequests, dogs, users } from "../src/db/schema.ts";

const jwtSecret = randomBytes(32).toString("hex");
const tokens = createAccessTokens(jwtSecret);
const password = "Temporary-adoption-test-42";
let passwordHash;
let api;
let initialCounts;
let fixtureUsers = [];
let fixtureDogs = [];

async function serve(database = db) {
  const server = createApp({ database, jwtSecret }).listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    origin: "http://127.0.0.1:" + server.address().port,
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

async function counts() {
  const [[row]] = await mysqlPool.query(
    "SELECT (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM dogs) AS dogs, " +
    "(SELECT COUNT(*) FROM dog_images) AS images, (SELECT COUNT(*) FROM adoption_requests) AS requests"
  );
  return row;
}

before(async () => {
  initialCounts = await counts();
  passwordHash = await bcrypt.hash(password, 11);
  api = await serve();
});

beforeEach(async () => {
  fixtureUsers = Array.from({ length: 2 }, () => {
    const id = randomUUID();
    return { id, name: "Adoption test", surname: "Temporary", age: 30,
      email: id + "@example.invalid", passwordHash, description: "Temporary integration fixture." };
  });
  fixtureDogs = Array.from({ length: 3 }, (_, index) => ({
    id: randomUUID(), name: "Adoption test dog", breed: "Mixed", age: 2,
    gender: "female", weight: 10, description: "Temporary integration fixture.",
    isAdopted: index === 2,
  }));
  // Commit only generated fixtures: separate HTTP transactions must see them
  // to exercise real locking and concurrent submissions through the pool.
  await db.transaction(async (tx) => {
    await tx.insert(users).values(fixtureUsers);
    await tx.insert(dogs).values(fixtureDogs);
  });
});

afterEach(async () => {
  // Delete only this test's UUIDs, in foreign-key order, even after failures.
  await db.transaction(async (tx) => {
    await tx.delete(adoptionRequests).where(inArray(adoptionRequests.userId, fixtureUsers.map((row) => row.id)));
    await tx.delete(dogs).where(inArray(dogs.id, fixtureDogs.map((row) => row.id)));
    await tx.delete(users).where(inArray(users.id, fixtureUsers.map((row) => row.id)));
  });
});

after(async () => {
  try {
    await api?.close();
    assert.deepEqual(await counts(), initialCounts, "Adoption tests must not leave any records behind.");
  } finally {
    await mysqlPool.end();
  }
});

async function request(path, { method = "GET", body, token = tokens.issue(fixtureUsers[0].id),
  contentType = "application/json", origin = api.origin } = {}) {
  const headers = { "Content-Type": contentType };
  if (token !== null) headers.Authorization = "Bearer " + token;
  const response = await fetch(origin + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json(), headers: response.headers };
}

const submit = (options = {}) => request("/adoptions", {
  method: "POST", body: { dogId: fixtureDogs[0].id }, ...options,
});
const myRequests = (options = {}) => request("/adoptions/me", options);
const ownRows = () => db.select().from(adoptionRequests)
  .where(inArray(adoptionRequests.userId, fixtureUsers.map((row) => row.id)));
const hasCode = (code) => (error) => (error.cause?.code || error.code) === code;

test("login token creates a persisted pending request, without adopting the dog", async () => {
  const login = await request("/users/login", {
    method: "POST", body: { email: fixtureUsers[0].email, password }, token: null,
  });
  assert.equal(login.status, 200);
  const created = await submit({
    token: login.body.accessToken, body: { dogId: fixtureDogs[0].id.toUpperCase() },
  });
  assert.equal(created.status, 201);
  assert.equal(created.headers.get("cache-control"), "no-store");
  assert.deepEqual(Object.keys(created.body).sort(), ["_id", "createdAt", "dogId", "status", "updatedAt"]);
  assert.equal(created.body.dogId, fixtureDogs[0].id);
  assert.equal(created.body.status, "pending");
  assert.ok(Number.isFinite(Date.parse(created.body.createdAt)));
  assert.ok(Number.isFinite(Date.parse(created.body.updatedAt)));
  const [stored] = await ownRows();
  assert.equal(stored.id, created.body._id);
  assert.equal(stored.userId, fixtureUsers[0].id);
  assert.equal(stored.dogId, fixtureDogs[0].id);
  assert.equal(stored.status, "pending");
  const mine = await myRequests();
  assert.equal(mine.status, 200);
  assert.equal(mine.headers.get("cache-control"), "no-store");
  assert.deepEqual(mine.body, [created.body]);
  const available = await request("/dogs");
  assert.ok(available.body.some((dog) => dog._id === fixtureDogs[0].id && !dog.isAdopted));
});

test("both endpoints reject missing, invalid, expired, wrong-signature and deleted-user tokens", async () => {
  await db.delete(users).where(eq(users.id, fixtureUsers[1].id));
  const expired = jwt.sign({ _id: fixtureUsers[0].id }, jwtSecret, {
    algorithm: "HS256", expiresIn: -1, issuer: "woof-paws-api", audience: "woof-paws-web",
  });
  for (const token of [
    null, "not-a-token", expired,
    createAccessTokens(randomBytes(32).toString("hex")).issue(fixtureUsers[0].id),
    tokens.issue(fixtureUsers[1].id),
  ]) {
    for (const response of [await submit({ token }), await myRequests({ token })]) {
      assert.equal(response.status, 401);
      assert.equal(response.headers.get("www-authenticate"), "Bearer");
      assert.equal(response.headers.get("cache-control"), "no-store");
    }
  }
  assert.deepEqual(await ownRows(), []);
});

test("submission rejects malformed payloads, forged ownership/status and wrong content types", async () => {
  for (const body of [
    null, [], {}, { dogId: 123 }, { dogId: ["bad"] }, { dogId: "not-a-uuid" },
    { dogId: fixtureDogs[0].id, userId: fixtureUsers[1].id },
    { dogId: fixtureDogs[0].id, user: fixtureUsers[1].id },
    { dogId: fixtureDogs[0].id, status: "approved" },
    { dog: fixtureDogs[0].id },
  ]) {
    assert.equal((await submit({ body })).status, 400);
  }
  assert.equal((await submit({ contentType: "text/plain" })).status, 415);
  assert.equal((await request("/adoptions?userId=" + fixtureUsers[1].id, {
    method: "POST", body: { dogId: fixtureDogs[0].id },
  })).status, 400);
  assert.deepEqual(await ownRows(), []);
});

test("missing and adopted dogs cannot receive requests", async () => {
  const missing = await submit({ body: { dogId: randomUUID() } });
  assert.equal(missing.status, 404);
  assert.deepEqual(missing.body, { message: "Dog not found." });
  const adopted = await submit({ body: { dogId: fixtureDogs[2].id } });
  assert.equal(adopted.status, 409);
  assert.match(adopted.body.message, /no longer available/);
  assert.deepEqual(await ownRows(), []);
});

test("duplicate submissions return 409 and preserve the original request", async () => {
  const first = await submit();
  assert.equal(first.status, 201);
  const duplicate = await submit();
  assert.equal(duplicate.status, 409);
  assert.deepEqual(duplicate.body, { message: "You have already requested adoption of this dog." });
  assert.deepEqual((await myRequests()).body, [first.body]);
});

test("simultaneous submissions for the same user and dog insert exactly one request", async () => {
  const responses = await Promise.all(Array.from({ length: 5 }, () => submit()));
  assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409, 409, 409, 409]);
  assert.equal((await ownRows()).length, 1);
});

test("different users can apply for the same available dog and see only their own request", async () => {
  const [first, second] = await Promise.all([
    submit(), submit({ token: tokens.issue(fixtureUsers[1].id) }),
  ]);
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.notEqual(first.body._id, second.body._id);
  assert.deepEqual((await myRequests()).body, [first.body]);
  assert.deepEqual((await myRequests({ token: tokens.issue(fixtureUsers[1].id) })).body, [second.body]);
  const [dog] = await db.select().from(dogs).where(eq(dogs.id, fixtureDogs[0].id));
  assert.equal(dog.isAdopted, false);
});

test("own requests are paginated newest first with stable ordering and an empty array when absent", async () => {
  assert.deepEqual((await myRequests()).body, []);
  const rows = fixtureDogs.map((dog, index) => ({
    id: randomUUID(), dogId: dog.id, userId: fixtureUsers[0].id,
    createdAt: new Date(index === 0 ? "2025-01-01T00:00:00Z" : "2025-01-02T00:00:00Z"),
  }));
  await db.insert(adoptionRequests).values([
    ...rows, { dogId: fixtureDogs[0].id, userId: fixtureUsers[1].id, createdAt: new Date("2025-01-03T00:00:00Z") },
  ]);
  const expected = await db.select({ _id: adoptionRequests.id }).from(adoptionRequests)
    .where(eq(adoptionRequests.userId, fixtureUsers[0].id))
    .orderBy(desc(adoptionRequests.createdAt), desc(adoptionRequests.id));
  const first = await request("/adoptions/me?limit=2");
  const second = await request("/adoptions/me?limit=1&offset=2");
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.deepEqual([...first.body, ...second.body].map((row) => row._id), expected.map((row) => row._id));
  assert.deepEqual((await request("/adoptions/me?offset=3")).body, []);
});

test("own listing rejects identity overrides and invalid or repeated pagination parameters", async () => {
  for (const query of [
    "?userId=" + fixtureUsers[1].id, "?status=pending", "?limit=0", "?limit=101",
    "?limit=1.5", "?limit=abc", "?limit=1&limit=2", "?limit[value]=1",
    "?offset=-1", "?offset=1.5", "?offset=100001", "?offset=0&offset=1",
  ]) {
    assert.equal((await request("/adoptions/me" + query)).status, 400, query);
  }
});

test("a previously reviewed request still prevents reapplication for the same dog", async () => {
  const created = await submit();
  assert.equal(created.status, 201);
  for (const status of ["approved", "rejected"]) {
    await db.update(adoptionRequests).set({ status }).where(eq(adoptionRequests.id, created.body._id));
    assert.equal((await submit()).status, 409);
    assert.equal((await myRequests()).body[0].status, status);
  }
});

test("foreign keys and uniqueness enforce request ownership and preserve history", async () => {
  const row = { userId: fixtureUsers[0].id, dogId: fixtureDogs[0].id };
  await assert.rejects(db.insert(adoptionRequests).values({ ...row, userId: randomUUID() }), hasCode("ER_NO_REFERENCED_ROW_2"));
  await assert.rejects(db.insert(adoptionRequests).values({ ...row, dogId: randomUUID() }), hasCode("ER_NO_REFERENCED_ROW_2"));
  await db.insert(adoptionRequests).values(row);
  await assert.rejects(db.insert(adoptionRequests).values(row), hasCode("ER_DUP_ENTRY"));
  await assert.rejects(db.delete(users).where(eq(users.id, row.userId)), hasCode("ER_ROW_IS_REFERENCED_2"));
  await assert.rejects(db.delete(dogs).where(eq(dogs.id, row.dogId)), hasCode("ER_ROW_IS_REFERENCED_2"));
  assert.equal((await ownRows()).length, 1);
});

test("an account deleted after authentication is rejected before an orphan request can be created", async (t) => {
  const deletingDb = {
    select: (...args) => db.select(...args),
    async transaction(callback) {
      await db.delete(users).where(eq(users.id, fixtureUsers[0].id));
      return db.transaction(callback);
    },
  };
  const deletingApi = await serve(deletingDb);
  t.after(() => deletingApi.close());
  const response = await submit({ origin: deletingApi.origin });
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("www-authenticate"), "Bearer");
  assert.deepEqual(await ownRows(), []);
});

test("a failed transaction rolls back the request, returns a generic 500 and allows a later retry", async (t) => {
  const log = t.mock.method(console, "error", () => {});
  const failingDb = {
    select: (...args) => db.select(...args),
    transaction: (callback) => db.transaction(async (tx) => {
      await callback(tx);
      throw Object.assign(new Error("Private SQL parameters."), { code: "ADOPTION_TEST_FAILURE" });
    }),
  };
  const failingApi = await serve(failingDb);
  t.after(() => failingApi.close());
  const response = await submit({ origin: failingApi.origin });
  assert.equal(response.status, 500);
  assert.deepEqual(response.body, { message: "An unexpected error occurred." });
  assert.deepEqual(log.mock.calls[0].arguments, ["Request failed:", "ADOPTION_TEST_FAILURE"]);
  assert.deepEqual(await ownRows(), []);
  assert.equal((await submit()).status, 201);
});

test("listing failures return a generic 500 rather than an empty list", async (t) => {
  const log = t.mock.method(console, "error", () => {});
  const failingDb = {
    select(fields) {
      if (Object.hasOwn(fields, "dogId")) {
        throw Object.assign(new Error("Private SQL parameters."), { code: "ADOPTION_LIST_FAILURE" });
      }
      return db.select(fields);
    },
  };
  const failingApi = await serve(failingDb);
  t.after(() => failingApi.close());
  const response = await myRequests({ origin: failingApi.origin });
  assert.equal(response.status, 500);
  assert.deepEqual(response.body, { message: "An unexpected error occurred." });
  assert.deepEqual(log.mock.calls[0].arguments, ["Request failed:", "ADOPTION_LIST_FAILURE"]);
});

async function reviewFixtures() {
  await db.update(users).set({ role: "admin" }).where(eq(users.id, fixtureUsers[1].id));
  const other = { ...fixtureUsers[0], id: randomUUID(), email: randomUUID() + "@example.invalid" };
  fixtureUsers.push(other);
  await db.insert(users).values(other);
  const rows = [
    { id: randomUUID(), userId: fixtureUsers[0].id, dogId: fixtureDogs[0].id },
    { id: randomUUID(), userId: other.id, dogId: fixtureDogs[0].id },
    { id: randomUUID(), userId: fixtureUsers[0].id, dogId: fixtureDogs[1].id },
  ];
  await db.insert(adoptionRequests).values(rows);
  return { rows, token: tokens.issue(fixtureUsers[1].id) };
}

const review = (id, status, token, options = {}) => request("/adoptions/" + id, {
  method: "PATCH", body: { status }, token, ...options,
});

test("admin listing and decisions require authentication and the current database admin role", async () => {
  const { rows, token } = await reviewFixtures();
  assert.equal((await request("/adoptions", { token: null })).status, 401);
  assert.equal((await review(rows[0].id, "approved", null)).status, 401);
  assert.equal((await request("/adoptions")).status, 403);
  assert.equal((await review(rows[0].id, "approved", tokens.issue(fixtureUsers[0].id))).status, 403);
  assert.equal((await request("/adoptions", { token })).status, 200);
  await db.update(users).set({ role: "user" }).where(eq(users.id, fixtureUsers[1].id));
  assert.equal((await request("/adoptions", { token })).status, 403);
  assert.equal((await review(rows[0].id, "approved", token)).status, 403);
  assert.ok((await ownRows()).every((row) => row.status === "pending"));
});

test("admin listing includes applicant and dog details, filters and pages without exposing hashes", async () => {
  const { rows, token } = await reviewFixtures();
  const response = await request("/adoptions?status=all&limit=100", { token });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const row = response.body.items.find((item) => item._id === rows[0].id);
  assert.deepEqual(Object.keys(row.user).sort(), ["_id", "age", "description", "email", "name", "surname"]);
  assert.equal(row.user._id, fixtureUsers[0].id);
  assert.equal(row.dog._id, fixtureDogs[0].id);
  assert.equal(row.dog.name, fixtureDogs[0].name);
  assert.equal(row.status, "pending");
  assert.equal(row.reviewedBy, null);
  assert.equal(row.reviewedAt, null);
  assert.ok(!JSON.stringify(response.body).includes(passwordHash));
  await review(rows[0].id, "rejected", token);
  const filtered = await request("/adoptions?status=rejected&limit=1", { token });
  assert.equal(filtered.status, 200);
  assert.ok(filtered.body.items.every((item) => item.status === "rejected"));
  assert.equal(filtered.body.limit, 1);
  assert.ok(filtered.body.total >= 1);
  const empty = await request("/adoptions?status=all&offset=100000", { token });
  assert.deepEqual(empty.body.items, []);
  for (const query of ["?status=other", "?status=pending&status=all", "?status[value]=pending",
    "?userId=other", "?limit=0", "?limit=101", "?offset=-1"]) {
    assert.equal((await request("/adoptions" + query, { token })).status, 400);
  }
});

test("approval adopts the dog, closes its competing requests and records the reviewer atomically", async () => {
  const { rows, token } = await reviewFixtures();
  const result = await review(rows[0].id, "approved", token);
  assert.equal(result.status, 200);
  assert.equal(result.body.status, "approved");
  assert.equal(result.body.reviewedBy, fixtureUsers[1].id);
  assert.ok(Number.isFinite(Date.parse(result.body.reviewedAt)));
  assert.equal(result.body.closedRequests, 1);
  const stored = await ownRows();
  assert.equal(stored.find((row) => row.id === rows[0].id).status, "approved");
  const competing = stored.find((row) => row.id === rows[1].id);
  assert.equal(competing.status, "rejected");
  assert.equal(competing.reviewedBy, fixtureUsers[1].id);
  assert.equal(competing.reviewedAt.toISOString(), result.body.reviewedAt);
  assert.equal(stored.find((row) => row.id === rows[2].id).status, "pending");
  const [dog] = await db.select().from(dogs).where(eq(dogs.id, fixtureDogs[0].id));
  assert.equal(dog.isAdopted, true);
  const listing = await request("/dogs");
  assert.ok(!listing.body.some((item) => item._id === dog.id));
  assert.equal((await myRequests()).body.find((item) => item._id === rows[0].id).status, "approved");
  assert.equal((await submit()).status, 409);
});

test("declining a request leaves the dog available and other applications pending", async () => {
  const { rows, token } = await reviewFixtures();
  const result = await review(rows[0].id, "rejected", token);
  assert.equal(result.status, 200);
  assert.equal(result.body.status, "rejected");
  assert.equal(result.body.closedRequests, 0);
  const stored = await ownRows();
  assert.equal(stored.find((row) => row.id === rows[1].id).status, "pending");
  const [dog] = await db.select().from(dogs).where(eq(dogs.id, fixtureDogs[0].id));
  assert.equal(dog.isAdopted, false);
  assert.equal((await review(rows[0].id, "approved", token)).status, 409);
});

test("two admins approving competing requests can approve only one adoption", async () => {
  const { rows, token } = await reviewFixtures();
  await db.update(users).set({ role: "admin" }).where(eq(users.id, fixtureUsers[2].id));
  const otherToken = tokens.issue(fixtureUsers[2].id);
  const outcomes = await Promise.all([
    review(rows[0].id, "approved", token), review(rows[1].id, "approved", otherToken),
  ]);
  assert.deepEqual(outcomes.map((item) => item.status).sort(), [200, 409]);
  const stored = (await ownRows()).filter((row) => row.dogId === fixtureDogs[0].id);
  assert.deepEqual(stored.map((row) => row.status).sort(), ["approved", "rejected"]);
  const winner = outcomes.find((item) => item.status === 200).body;
  assert.ok(stored.every((row) => row.reviewedBy === winner.reviewedBy));
});

test("simultaneous approve/decline decisions on one request cannot overwrite the first decision", async () => {
  const { rows, token } = await reviewFixtures();
  const outcomes = await Promise.all([
    review(rows[0].id, "approved", token), review(rows[0].id, "rejected", token),
  ]);
  assert.deepEqual(outcomes.map((item) => item.status).sort(), [200, 409]);
  const winner = outcomes.find((item) => item.status === 200).body;
  const [stored] = await db.select().from(adoptionRequests).where(eq(adoptionRequests.id, rows[0].id));
  const [dog] = await db.select().from(dogs).where(eq(dogs.id, fixtureDogs[0].id));
  assert.equal(stored.status, winner.status);
  assert.equal(dog.isAdopted, winner.status === "approved");
});

test("admin decisions validate IDs, status, JSON and extra fields before updating", async () => {
  const { rows, token } = await reviewFixtures();
  assert.equal((await review("invalid", "approved", token)).status, 400);
  assert.equal((await review(randomUUID(), "approved", token)).status, 404);
  assert.equal((await review(rows[0].id, "pending", token)).status, 400);
  assert.equal((await review(rows[0].id, "approved", token, { contentType: "text/plain" })).status, 415);
  for (const body of [null, [], {}, { status: "approved", userId: fixtureUsers[0].id },
    { status: "approved", reviewedBy: fixtureUsers[0].id }, { status: ["approved"] }]) {
    assert.equal((await review(rows[0].id, "approved", token, { body })).status, 400);
  }
  assert.equal((await review(rows[0].id + "?status=approved", "approved", token)).status, 400);
  assert.ok((await ownRows()).every((row) => row.status === "pending"));
});

test("an already adopted dog cannot be approved again but its pending request can be declined", async () => {
  const { rows, token } = await reviewFixtures();
  await db.update(dogs).set({ isAdopted: true }).where(eq(dogs.id, fixtureDogs[0].id));
  assert.equal((await review(rows[0].id, "approved", token)).status, 409);
  assert.equal((await review(rows[0].id, "rejected", token)).status, 200);
});

test("admin role is rechecked inside the decision transaction", async (t) => {
  const { rows, token } = await reviewFixtures();
  const demotingDb = {
    select: (...args) => db.select(...args),
    async transaction(callback) {
      await db.update(users).set({ role: "user" }).where(eq(users.id, fixtureUsers[1].id));
      return db.transaction(callback);
    },
  };
  const demotingApi = await serve(demotingDb);
  t.after(() => demotingApi.close());
  const result = await review(rows[0].id, "approved", token, { origin: demotingApi.origin });
  assert.equal(result.status, 403);
  assert.ok((await ownRows()).every((row) => row.status === "pending"));
});

test("failed approval rolls back the decision, competing requests and dog availability together", async (t) => {
  const { rows, token } = await reviewFixtures();
  const log = t.mock.method(console, "error", () => {});
  const failingDb = {
    select: (...args) => db.select(...args),
    transaction: (callback) => db.transaction(async (tx) => {
      await callback(tx);
      throw Object.assign(new Error("Private transaction details."), { code: "REVIEW_TEST_FAILURE" });
    }),
  };
  const failingApi = await serve(failingDb);
  t.after(() => failingApi.close());
  const result = await review(rows[0].id, "approved", token, { origin: failingApi.origin });
  assert.equal(result.status, 500);
  assert.deepEqual(result.body, { message: "An unexpected error occurred." });
  assert.deepEqual(log.mock.calls[0].arguments, ["Request failed:", "REVIEW_TEST_FAILURE"]);
  assert.ok((await ownRows()).every((row) => row.status === "pending" && row.reviewedBy === null));
  const [dog] = await db.select().from(dogs).where(eq(dogs.id, fixtureDogs[0].id));
  assert.equal(dog.isAdopted, false);
  assert.equal((await review(rows[0].id, "approved", token)).status, 200);
});
