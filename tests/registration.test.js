import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { before, after, beforeEach, afterEach, test } from "node:test";
import bcrypt from "bcrypt";
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { createApp } from "../src/app.js";
import { mysqlConfig } from "../src/db/config.js";
import { mysqlPool } from "../src/db/mysql.js";

let connection;
let server;
let origin;
let initialCount;

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

before(async () => {
  connection = await mysql.createConnection(mysqlConfig);
  const [[row]] = await connection.query("SELECT COUNT(*) AS total FROM users");
  initialCount = row.total;
  server = createApp({ registrationDb: drizzle(connection) }).listen(0, "127.0.0.1");
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
  for (const path of ["/dogs", "/users/me", "/adoptions"]) {
    const response = await fetch(origin + path, { signal: AbortSignal.timeout(2000) });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { message: "This feature is temporarily unavailable." });
  }
});

test("the server entry point starts with MySQL and no MongoDB", { timeout: 15000 }, async (t) => {
  const child = spawn(process.execPath, ["src/server.js"], {
    env: { ...process.env, PORT: "0", API_HOST: "127.0.0.1", MONGO_URL: "" },
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
