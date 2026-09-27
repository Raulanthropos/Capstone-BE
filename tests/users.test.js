import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { before, after, beforeEach, afterEach, test } from "node:test";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { createApp } from "../src/app.js";
import { mysqlConfig } from "../src/db/config.js";
import { mysqlPool } from "../src/db/mysql.js";

let connection;
let server;
let origin;
let initialCount;
const jwtSecret = randomBytes(32).toString("hex");

function userDetails(overrides = {}) {
  return {
    name: "  Test  ",
    surname: "User",
    age: 30,
    email: "registration-" + randomUUID() + "@example.invalid",
    password: "Local-test-password-42",
    description: "A temporary registration integration test.",
    ...overrides,
  };
}

async function register(details) {
  const response = await fetch(origin + "/users/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(details),
  });
  return { status: response.status, body: await response.json() };
}

async function login(details) {
  const response = await fetch(origin + "/users/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(details),
  });
  return { status: response.status, body: await response.json(), headers: response.headers };
}

async function profile(accessToken) {
  const response = await fetch(origin + "/users/me", {
    headers: { Authorization: "Bearer " + accessToken },
  });
  return { status: response.status, body: await response.json(), headers: response.headers };
}

before(async () => {
  connection = await mysql.createConnection(mysqlConfig);
  const [[row]] = await connection.query("SELECT COUNT(*) AS total FROM users");
  initialCount = row.total;
  server = createApp({ database: drizzle(connection), jwtSecret }).listen(0, "127.0.0.1");
  await once(server, "listening");
  origin = "http://127.0.0.1:" + server.address().port;
});

beforeEach(async () => {
  await connection.beginTransaction();
});

afterEach(async () => {
  await connection.rollback();
});

after(async () => {
  if (server?.listening) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  try {
    if (connection) {
      await connection.rollback();
      const [[row]] = await connection.query("SELECT COUNT(*) AS total FROM users");
      assert.equal(row.total, initialCount, "Integration tests must not leave users behind.");
    }
  } finally {
    await connection?.end();
    await mysqlPool.end();
  }
});

test("JSON registration stores a normalized user and hash, ignoring a requested admin role", async () => {
  const details = userDetails({ role: "admin" });
  details.email = "  " + details.email.toUpperCase() + "  ";
  const response = await register(details);
  assert.equal(response.status, 201);
  assert.deepEqual(Object.keys(response.body), ["_id"]);
  assert.match(response.body._id, /^[0-9a-f-]{36}$/i);

  const [[stored]] = await connection.execute("SELECT * FROM users WHERE id = ?", [response.body._id]);
  assert.equal(stored.name, "Test");
  assert.equal(stored.email, details.email.trim().toLowerCase());
  assert.equal(stored.age, 30);
  assert.equal(stored.role, "user");
  assert.equal(stored.picture, null);
  assert.notEqual(stored.password_hash, details.password);
  assert.equal(await bcrypt.compare(details.password, stored.password_hash), true);
  assert.equal(await bcrypt.compare("wrong-password", stored.password_hash), false);
});

test("registration accepts the text-only FormData used by the frontend", async () => {
  const form = new FormData();
  for (const [key, value] of Object.entries(userDetails({ role: "user" }))) {
    form.append(key, String(value));
  }
  const response = await fetch(origin + "/users/register", { method: "POST", body: form });
  assert.equal(response.status, 201);
  const { _id } = await response.json();
  const [[stored]] = await connection.execute("SELECT age FROM users WHERE id = ?", [_id]);
  assert.equal(stored.age, 30);
});

test("duplicate normalized email returns 409", async () => {
  const details = userDetails();
  assert.equal((await register(details)).status, 201);
  const duplicate = await register({ ...details, email: " " + details.email.toUpperCase() + " " });
  assert.equal(duplicate.status, 409);
  assert.deepEqual(duplicate.body, { message: "A user with this email already exists." });
});

test("simultaneous requests for the same email create only one user", async () => {
  const details = userDetails();
  const responses = await Promise.all([register(details), register(details)]);
  assert.deepEqual(responses.map(({ status }) => status).sort(), [201, 409]);
  const [[row]] = await connection.execute("SELECT COUNT(*) AS total FROM users WHERE email = ?", [details.email]);
  assert.equal(row.total, 1);
});

test("invalid fields are rejected before insertion without echoing passwords", async () => {
  const invalidFields = [
    ["name", ""], ["name", "x".repeat(101)], ["surname", null],
    ["email", "not-an-email"], ["email", { address: "test@example.invalid" }],
    ["age", -1], ["age", 30.5], ["age", "30years"], ["age", true], ["age", 131],
    ["description", ""], ["description", "x".repeat(5001)],
    ["password", "short"], ["password", "a".repeat(73)], ["password", "€".repeat(25)],
  ];
  for (const [field, value] of invalidFields) {
    const details = userDetails({ [field]: value });
    const response = await register(details);
    assert.equal(response.status, 400, field + " must be rejected");
    assert.ok(response.body.errors.some((error) => error.field === field));
    assert.ok(response.body.errors.every((error) => !Object.hasOwn(error, "value")));
    const [[row]] = await connection.query("SELECT COUNT(*) AS total FROM users");
    assert.equal(row.total, initialCount);
  }
});

test("a password exactly 72 UTF-8 bytes is accepted without truncation", async () => {
  const details = userDetails({ password: "€".repeat(24) });
  const response = await register(details);
  assert.equal(response.status, 201);
  const [[row]] = await connection.execute("SELECT password_hash FROM users WHERE id = ?", [response.body._id]);
  assert.equal(await bcrypt.compare(details.password, row.password_hash), true);
});

test("malformed JSON returns a JSON error without returning the submitted body", async () => {
  const response = await fetch(origin + "/users/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: '{"password":"do-not-echo-this",',
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { message: "Invalid JSON body." });
});

test("file uploads and malformed multipart forms are rejected", async () => {
  const form = new FormData();
  for (const [key, value] of Object.entries(userDetails())) form.append(key, String(value));
  form.append("picture", new Blob(["not-an-image"], { type: "image/png" }), "avatar.png");
  const response = await fetch(origin + "/users/register", { method: "POST", body: form });
  assert.equal(response.status, 400);
  assert.match((await response.json()).message, /uploads are not supported/);

  const malformed = await fetch(origin + "/users/register", {
    method: "POST", headers: { "Content-Type": "multipart/form-data" }, body: "missing-boundary",
  });
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).message, "Invalid registration form.");
});

test("unsupported content types and oversized JSON requests are rejected", async () => {
  const unsupported = await fetch(origin + "/users/register", { method: "POST", body: "plain text" });
  assert.equal(unsupported.status, 415);
  await unsupported.json();
  const oversized = await register(userDetails({ description: "x".repeat(70 * 1024) }));
  assert.equal(oversized.status, 413);
});

test("localhost frontend preflight is allowed", async () => {
  const response = await fetch(origin + "/users/register", {
    method: "OPTIONS",
    headers: { Origin: "http://localhost:3000", "Access-Control-Request-Method": "POST" },
  });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), "http://localhost:3000");
});

test("unmigrated endpoints return 503 promptly without MongoDB", async () => {
  for (const path of ["/dogs/00000000-0000-4000-8000-000000000001", "/users", "/adoptions"]) {
    const response = await fetch(origin + path, { signal: AbortSignal.timeout(2000) });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { message: "This feature is temporarily unavailable." });
  }
});

test("the server entry point starts with MySQL and no MongoDB", { timeout: 15000 }, async (t) => {
  const child = spawn(process.execPath, ["src/server.js"], {
    env: { ...process.env, PORT: "0", API_HOST: "127.0.0.1", MONGO_URL: "", JWT_SECRET: jwtSecret },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = once(child, "exit");
  t.after(async () => {
    if (child.exitCode === null) child.kill();
    await exited;
  });
  let output = "";
  let errorOutput = "";
  child.stderr.on("data", (chunk) => { errorOutput += chunk; });
  const address = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Server startup timed out: " + errorOutput)), 10000);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("exit", () => { clearTimeout(timer); reject(new Error("Server exited: " + errorOutput)); });
    child.stdout.on("data", (chunk) => {
      output += chunk;
      const match = output.match(/API listening at (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
  const response = await fetch(address + "/users/register", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
  });
  assert.equal(response.status, 400);
  await response.json();
});

test("registration, login and profile lookup work together without MongoDB", async () => {
  const details = userDetails();
  const registered = await register(details);
  const loggedIn = await login({ email: "  " + details.email.toUpperCase() + "  ", password: details.password });
  assert.equal(loggedIn.status, 200);
  assert.deepEqual(Object.keys(loggedIn.body).sort(), ["accessToken", "user"]);
  const expectedUser = {
    _id: registered.body._id,
    name: "Test", surname: details.surname, age: details.age,
    email: details.email, picture: null, role: "user", description: details.description,
  };
  assert.deepEqual(loggedIn.body.user, expectedUser);
  assert.equal(loggedIn.headers.get("cache-control"), "no-store");
  const claims = jwt.verify(loggedIn.body.accessToken, jwtSecret, {
    algorithms: ["HS256"], issuer: "woof-paws-api", audience: "woof-paws-web",
  });
  assert.equal(claims._id, registered.body._id);
  assert.equal(claims.exp - claims.iat, 3600);
  assert.deepEqual(Object.keys(claims).sort(), ["_id", "aud", "exp", "iat", "iss"]);
  const me = await profile(loggedIn.body.accessToken);
  assert.equal(me.status, 200);
  assert.deepEqual(me.body, expectedUser);
  assert.equal(me.headers.get("cache-control"), "no-store");
});

test("wrong passwords and unknown emails return the same 401 response", async () => {
  const details = userDetails();
  await register(details);
  for (const credentials of [
    { email: details.email, password: "wrong-password" },
    { email: userDetails().email, password: details.password },
  ]) {
    const response = await login(credentials);
    assert.equal(response.status, 401);
    assert.deepEqual(response.body, { message: "Invalid email or password." });
  }
});

test("login preserves password whitespace and accepts exactly 72 UTF-8 bytes", async () => {
  for (const password of ["  space-sensitive-password  ", "\u20ac".repeat(24)]) {
    const details = userDetails({ password });
    assert.equal((await register(details)).status, 201);
    assert.equal((await login(details)).status, 200);
    if (password.trim() !== password) {
      assert.equal((await login({ ...details, password: password.trim() })).status, 401);
    } else {
      // Bcrypt would accept this prefix if the API allowed silent truncation.
      assert.equal((await login({ ...details, password: password + "x" })).status, 400);
    }
  }
});

test("login rejects invalid input without returning submitted values", async () => {
  for (const details of [
    {}, { email: "not-an-email", password: "do-not-echo-this" },
    { email: { address: "test@example.invalid" }, password: "do-not-echo-this" },
    { email: "test@example.invalid", password: null },
    { email: "test@example.invalid", password: ["do-not-echo-this"] },
    { email: "test@example.invalid", password: "" },
    { email: "test@example.invalid", password: "a".repeat(73) },
  ]) {
    const response = await login(details);
    assert.equal(response.status, 400);
    assert.ok(response.body.errors.every((error) => !Object.hasOwn(error, "value")));
    assert.ok(!JSON.stringify(response.body).includes("do-not-echo-this"));
  }
  const unsupported = await fetch(origin + "/users/login", { method: "POST", body: "plain text" });
  assert.equal(unsupported.status, 415);
  await unsupported.json();
  const malformed = await fetch(origin + "/users/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: '{"password":"do-not-echo-this",',
  });
  assert.equal(malformed.status, 400);
  assert.deepEqual(await malformed.json(), { message: "Invalid JSON body." });
});

test("profile rejects missing, malformed and invalid Bearer credentials", async () => {
  for (const authorization of [undefined, "Basic abc", "Bearer", "Bearer not-a-jwt", "Bearer a b"]) {
    const response = await fetch(origin + "/users/me", {
      headers: authorization ? { Authorization: authorization } : {},
    });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("www-authenticate"), "Bearer");
    assert.deepEqual(await response.json(), { message: "Authentication required. Please log in again." });
  }
});

test("profile rejects expired, forged and inappropriate JWTs", async () => {
  const registered = await register(userDetails());
  const payload = { _id: registered.body._id };
  const options = { algorithm: "HS256", expiresIn: "1h", issuer: "woof-paws-api", audience: "woof-paws-web" };
  const tokens = [
    jwt.sign(payload, jwtSecret, { ...options, expiresIn: -1 }),
    jwt.sign(payload, randomBytes(32).toString("hex"), options),
    jwt.sign(payload, jwtSecret, { ...options, issuer: "another-api" }),
    jwt.sign(payload, jwtSecret, { ...options, audience: "another-client" }),
    jwt.sign(payload, jwtSecret, { ...options, algorithm: "HS384" }),
    jwt.sign(payload, null, { ...options, algorithm: "none" }),
    jwt.sign(payload, jwtSecret, { ...options, notBefore: "1h" }),
    jwt.sign(payload, jwtSecret, { issuer: options.issuer, audience: options.audience }),
    jwt.sign(payload, jwtSecret, { ...options, noTimestamp: true }),
    jwt.sign({ _id: "not-a-uuid" }, jwtSecret, options),
    jwt.sign({ _id: [registered.body._id] }, jwtSecret, options),
    // Old MongoDB tokens must not authenticate against MySQL.
    jwt.sign({ _id: "507f1f77bcf86cd799439011", email: "old@example.invalid" }, jwtSecret, { expiresIn: "1h" }),
  ];
  for (const token of tokens) {
    const response = await profile(token);
    assert.equal(response.status, 401);
    assert.deepEqual(response.body, { message: "Authentication required. Please log in again." });
  }
});

test("profile reads current database values and rejects a deleted user", async () => {
  const details = userDetails();
  const registered = await register(details);
  const { accessToken } = (await login(details)).body;
  await connection.execute("UPDATE users SET name = ?, role = ? WHERE id = ?", ["Updated", "admin", registered.body._id]);
  const updated = await profile(accessToken);
  assert.equal(updated.status, 200);
  assert.equal(updated.body.name, "Updated");
  assert.equal(updated.body.role, "admin");
  await connection.execute("DELETE FROM users WHERE id = ?", [registered.body._id]);
  assert.equal((await profile(accessToken)).status, 401);
});

test("profile identity comes from the verified token, not query parameters", async () => {
  const first = userDetails();
  const second = userDetails();
  const firstUser = await register(first);
  const secondUser = await register(second);
  const { accessToken } = (await login(first)).body;
  const response = await fetch(origin + "/users/me?userId=" + secondUser.body._id, {
    headers: { Authorization: "bearer " + accessToken },
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json())._id, firstUser.body._id);
});

test("database failures remain generic 500 errors without leaking query details", async (t) => {
  const log = t.mock.method(console, "error", () => {});
  const database = {
    select() {
      const error = new Error("Sensitive SQL parameters must never be returned or logged.");
      error.cause = { code: "DB_TEST_FAILURE" };
      throw error;
    },
  };
  const failingServer = createApp({ database, jwtSecret }).listen(0, "127.0.0.1");
  await once(failingServer, "listening");
  t.after(async () => {
    failingServer.closeAllConnections();
    await new Promise((resolve) => failingServer.close(resolve));
  });
  const address = "http://127.0.0.1:" + failingServer.address().port;
  const token = jwt.sign({ _id: randomUUID() }, jwtSecret, {
    algorithm: "HS256", expiresIn: "1h", issuer: "woof-paws-api", audience: "woof-paws-web",
  });
  for (const [path, options] of [
    ["/users/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(userDetails()) }],
    ["/users/me", { headers: { Authorization: "Bearer " + token } }],
  ]) {
    const response = await fetch(address + path, options);
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { message: "An unexpected error occurred." });
  }
  assert.deepEqual(log.mock.calls.map((call) => call.arguments), [
    ["Request failed:", "DB_TEST_FAILURE"], ["Request failed:", "DB_TEST_FAILURE"],
  ]);
});
