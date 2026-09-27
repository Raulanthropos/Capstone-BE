import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import { before, after, beforeEach, afterEach, test } from "node:test";
import jwt from "jsonwebtoken";
import { io } from "socket.io-client";
import { eq, inArray } from "drizzle-orm";
import { createApp } from "../src/app.js";
import { createAccessTokens } from "../src/lib/auth/accessTokens.js";
import { attachRealtime } from "../src/lib/realtime.js";
import { db } from "../src/db/index.js";
import { mysqlPool } from "../src/db/mysql.js";
import { adoptionRequests, dogs, users, messages, notifications } from "../src/db/schema.ts";

const secret = randomBytes(32).toString("hex");
const tokens = createAccessTokens(secret);
let server, realtime, origin, baseline;
let people = [], dogRows = [], sockets = [];
const counts = async () => (await mysqlPool.query(
  "SELECT (SELECT COUNT(*) FROM users) users, (SELECT COUNT(*) FROM dogs) dogs, " +
  "(SELECT COUNT(*) FROM adoption_requests) requests, (SELECT COUNT(*) FROM messages) messages, " +
  "(SELECT COUNT(*) FROM notifications) notifications"
))[0][0];

before(async () => {
  baseline = await counts();
  server = createServer(createApp({ jwtSecret: secret, onInboxChanged: (ids) => realtime.publish(ids) }));
  realtime = attachRealtime(server, db, tokens);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  origin = "http://127.0.0.1:" + server.address().port;
});
beforeEach(async () => {
  people = ["user", "user", "admin"].map((role) => ({
    id: randomUUID(), name: "Inbox", surname: "Fixture", age: 30, role,
    email: randomUUID() + "@example.invalid", passwordHash: "unused", description: "Temporary test data.",
  }));
  dogRows = [0, 1].map(() => ({
    id: randomUUID(), name: "Inbox dog", breed: "Mixed", age: 2, gender: "female",
    weight: 10, description: "Temporary test data.",
  }));
  await db.insert(users).values(people);
  await db.insert(dogs).values(dogRows);
});
afterEach(async () => {
  sockets.forEach((socket) => socket.disconnect());
  sockets = [];
  await db.transaction(async (tx) => {
    await tx.delete(adoptionRequests).where(inArray(adoptionRequests.userId, people.map((user) => user.id)));
    await tx.delete(dogs).where(inArray(dogs.id, dogRows.map((dog) => dog.id)));
    await tx.delete(users).where(inArray(users.id, people.map((user) => user.id)));
  });
});
after(async () => {
  try {
    await realtime?.close();
    assert.deepEqual(await counts(), baseline, "Inbox tests must remove only their fixtures and leave no notifications behind.");
  } finally { await mysqlPool.end(); }
});
async function request(path, { user = 0, method = "GET", body, token = tokens.issue(people[user].id) } = {}) {
  const res = await fetch(origin + path, { method,
    headers: { ...(token ? { Authorization: "Bearer " + token } : {}), "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: await res.json(), headers: res.headers };
}
async function application(user = 0, dog = 0) {
  const result = await request("/adoptions", { user, method: "POST", body: { dogId: dogRows[dog].id } });
  assert.equal(result.status, 201);
  return result.body._id;
}
const listNotifications = (user = 0) => request("/inbox/notifications", { user });
const send = (id, options = {}) => request("/inbox/conversations/" + id + "/messages", {
  method: "POST", body: { body: "Hello from the applicant.", clientMessageId: randomUUID() }, ...options,
});
function connect(token) {
  const socket = io(origin, { auth: { token }, transports: ["websocket"], reconnection: false });
  sockets.push(socket);
  return socket;
}
const waitEvent = (socket, event) => once(socket, event, { signal: AbortSignal.timeout(4000) });

test("new applications notify admins; decisions notify applicants including competing requests", async () => {
  const first = await application();
  const second = await application(1);
  const admin = await listNotifications(2);
  assert.equal(admin.body.unread, 2);
  assert.ok(admin.body.items.every((item) => item.kind === "adoption_created"));
  assert.equal((await listNotifications()).body.unread, 0);
  const reviewed = await request("/adoptions/" + first, { user: 2, method: "PATCH", body: { status: "approved" } });
  assert.equal(reviewed.status, 200);
  const winner = await listNotifications();
  const other = await listNotifications(1);
  assert.equal(winner.body.items[0].kind, "adoption_approved");
  assert.equal(other.body.items[0].kind, "adoption_rejected");
  assert.equal(other.body.items[0].requestId, second);
  await request("/adoptions/" + first, { user: 2, method: "PATCH", body: { status: "approved" } });
  assert.equal((await listNotifications()).body.total, 1);
});

test("notifications are private, support idempotent read and mark-all, and enforce current admin role", async () => {
  await application();
  const adminNotice = (await listNotifications(2)).body.items[0];
  assert.equal((await request("/inbox/notifications/" + adminNotice._id + "/read", { method: "PATCH", body: {} })).status, 404);
  for (let index = 0; index < 2; index++) {
    assert.equal((await request("/inbox/notifications/" + adminNotice._id + "/read", { user: 2, method: "PATCH", body: {} })).status, 200);
  }
  assert.equal((await listNotifications(2)).body.unread, 0);
  await application(0, 1);
  assert.equal((await listNotifications(2)).body.unread, 1);
  await request("/inbox/notifications/read-all", { user: 2, method: "POST", body: {} });
  assert.equal((await listNotifications(2)).body.unread, 0);
  await db.update(users).set({ role: "user" }).where(eq(users.id, people[2].id));
  assert.equal((await listNotifications(2)).body.total, 0);
});

test("messages persist, notify the other side and retries cannot duplicate a send", async () => {
  const id = await application();
  const body = { body: "Is she comfortable around cats?", clientMessageId: randomUUID() };
  const results = await Promise.all([send(id, { body }), send(id, { body })]);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 201]);
  assert.equal(results[0].body._id, results[1].body._id);
  assert.equal((await listNotifications(2)).body.items.filter((item) => item.kind === "message").length, 1);
  assert.equal((await listNotifications()).body.unread, 0);
  const reply = await send(id, { user: 2 });
  assert.equal(reply.status, 201);
  assert.equal((await listNotifications()).body.items[0].kind, "message");
  const history = await request("/inbox/conversations/" + id + "/messages");
  assert.equal(history.body.items.length, 2);
  assert.equal(history.body.items[0].body, body.body);
  assert.equal(history.headers.get("cache-control"), "no-store");
  assert.equal((await send(id, { body: { ...body, body: "Changed content" } })).status, 409);
});

test("outsiders and demoted admins cannot read, send or enumerate another applicant's conversation", async () => {
  const id = await application();
  await send(id);
  for (const suffix of ["", "/messages"]) {
    assert.equal((await request("/inbox/conversations/" + id + suffix, { user: 1 })).status, 404);
  }
  assert.equal((await send(id, { user: 1 })).status, 404);
  assert.equal((await request("/inbox/conversations", { user: 1 })).body.total, 0);
  assert.equal((await request("/inbox/conversations/" + id, { user: 2 })).status, 200);
  await db.update(users).set({ role: "user" }).where(eq(users.id, people[2].id));
  assert.equal((await send(id, { user: 2 })).status, 404);
  assert.equal((await request("/inbox/conversations/" + id + "/messages", { user: 2 })).status, 404);
});

test("message history paginates without overlap while new messages arrive", async () => {
  const id = await application();
  for (let index = 0; index < 3; index++) assert.equal((await send(id)).status, 201);
  const path = "/inbox/conversations/" + id + "/messages";
  const latest = await request(path + "?limit=2");
  assert.equal(latest.body.items.length, 2);
  assert.equal(latest.body.hasMore, true);
  assert.ok(latest.body.items[0]._id < latest.body.items[1]._id);
  await send(id);
  const older = await request(path + "?limit=2&beforeId=" + latest.body.nextBeforeId);
  assert.equal(older.body.items.length, 1);
  assert.equal(older.body.hasMore, false);
  assert.ok(older.body.items[0]._id < latest.body.items[0]._id);
});

test("validates message payloads, prevents identity spoofing, rejects unauthenticated requests", async () => {
  const id = await application();
  for (const body of [
    { body: " ", clientMessageId: randomUUID() },
    { body: "a".repeat(2001), clientMessageId: randomUUID() },
    { body: "Hi", clientMessageId: "bad" },
    { body: "Hi", clientMessageId: randomUUID(), senderId: people[2].id },
  ]) assert.equal((await send(id, { body })).status, 400);
  assert.equal((await send(id, { token: null })).status, 401);
  assert.equal((await request("/inbox/notifications", { token: null })).status, 401);
  assert.equal((await request("/inbox/conversations/" + id + "/messages?limit=0")).status, 400);
  assert.equal((await request("/inbox/conversations?offset=-1")).status, 400);
  assert.equal((await send(id, { body: { body: "<script>alert('x')</script>", clientMessageId: randomUUID() } })).status, 201);
});

test("Socket.IO authenticates and delivers an invalidation only to the actual recipients", async () => {
  const id = await application();
  const admin = connect(tokens.issue(people[2].id));
  const outsider = connect(tokens.issue(people[1].id));
  await Promise.all([waitEvent(admin, "connect"), waitEvent(outsider, "connect")]);
  let outsiderEvents = 0;
  outsider.on("inbox:changed", () => outsiderEvents++);
  outsider.emit("join", "user:" + people[2].id);
  const delivered = waitEvent(admin, "inbox:changed");
  assert.equal((await send(id)).status, 201);
  assert.deepEqual(await delivered, [], "No message content or identifiers should be broadcast.");
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(outsiderEvents, 0);
  assert.equal((await listNotifications(2)).body.items[0].kind, "message");
});

test("Socket.IO rejects invalid/expired tokens and disconnects when an established token expires", async () => {
  for (const token of ["bad", jwt.sign({ _id: people[0].id }, secret, {
    issuer: "woof-paws-api", audience: "woof-paws-web", expiresIn: -1,
  })]) {
    const socket = connect(token);
    const [error] = await waitEvent(socket, "connect_error");
    assert.equal(error.data.code, "UNAUTHENTICATED");
    assert.equal(socket.connected, false);
  }
  const socket = connect(jwt.sign({ _id: people[0].id }, secret, {
    issuer: "woof-paws-api", audience: "woof-paws-web", expiresIn: 2,
  }));
  await waitEvent(socket, "connect");
  const expired = waitEvent(socket, "session:expired");
  await expired;
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(socket.connected, false);
});

test("notification failure rolls back an application instead of persisting a partial action", async () => {
  const broken = Object.create(db);
  broken.transaction = (callback) => db.transaction((tx) => callback(new Proxy(tx, {
    get(target, property) {
      if (property === "insert") return (table) => {
        if (table === notifications) throw new Error("Simulated notification write failure");
        return target.insert(table);
      };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  })));
  const api = createApp({ database: broken, jwtSecret: secret }).listen(0, "127.0.0.1");
  await once(api, "listening");
  try {
    const response = await fetch("http://127.0.0.1:" + api.address().port + "/adoptions", {
      method: "POST", headers: { Authorization: "Bearer " + tokens.issue(people[0].id), "Content-Type": "application/json" },
      body: JSON.stringify({ dogId: dogRows[0].id }),
    });
    assert.equal(response.status, 500);
    assert.deepEqual(await db.select().from(adoptionRequests).where(eq(adoptionRequests.userId, people[0].id)), []);
  } finally {
    api.closeAllConnections();
    await new Promise((resolve) => api.close(resolve));
  }
});
