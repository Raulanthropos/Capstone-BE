import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, writeFile, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rootCertificates } from "node:tls";
import { once } from "node:events";
import { after, test } from "node:test";
import { getMysqlConfig } from "../src/db/settings.js";
import { getHttpSettings } from "../src/lib/deployment.js";
import { getAllowedOrigins } from "../src/lib/origins.js";
import { createAuthRateLimits } from "../src/lib/auth/rateLimits.js";
import { createApp } from "../src/app.js";
import { mysqlPool } from "../src/db/mysql.js";

const dbEnv = { DB_HOST: "db.example.test", DB_PORT: "19221", DB_NAME: "defaultdb", DB_USER: "app", DB_PASSWORD: "test-only" };
const jwtSecret = randomBytes(32).toString("hex");
after(() => mysqlPool.end());

test("local DB settings remain usable and production requires verified TLS", () => {
  assert.equal(getMysqlConfig(dbEnv).ssl, undefined);
  assert.throws(() => getMysqlConfig({ ...dbEnv, NODE_ENV: "production" }), /DB_SSL=true/);
  const config = getMysqlConfig({ ...dbEnv, NODE_ENV: "production", DB_SSL: "true" });
  assert.deepEqual(config.ssl, { rejectUnauthorized: true, verifyIdentity: true });
  for (const DB_SSL of ["1", "yes", "FALSE"]) assert.throws(() => getMysqlConfig({ ...dbEnv, DB_SSL }));
  assert.throws(() => getMysqlConfig({ ...dbEnv, DB_SSL_CA_PATH: "unused.pem" }), /requires DB_SSL=true/);
  assert.throws(() => getMysqlConfig({ ...dbEnv, DB_PORT: "invalid" }), /DB_PORT/);
  assert.throws(() => getMysqlConfig({ ...dbEnv, DB_PASSWORD: "" }), /DB_PASSWORD/);
});

test("provider CA is loaded from a file and missing or malformed files fail closed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "woof-ca-test-"));
  try {
    const file = join(dir, "ca.pem");
    const env = { ...dbEnv, DB_SSL: "true", DB_SSL_CA_PATH: file };
    assert.throws(() => getMysqlConfig(env), { code: "ENOENT" });
    await writeFile(file, rootCertificates[0]);
    assert.equal(getMysqlConfig(env).ssl.ca, rootCertificates[0]);
    assert.equal(getMysqlConfig(env).ssl.verifyIdentity, true);
    await writeFile(file, "invalid certificate");
    assert.throws(() => getMysqlConfig(env), /Invalid MySQL CA/);
  } finally { await rm(join(dir, "ca.pem"), { force: true }); await rmdir(dir); }
});

test("Render settings bind publicly, honor PORT, and use the public HTTPS origin", () => {
  const local = getHttpSettings({});
  assert.equal(local.host, "127.0.0.1");
  assert.equal(local.trustProxy, 0);
  const deployed = getHttpSettings({ NODE_ENV: "production", PORT: "10000", TRUST_PROXY: "1",
    RENDER_EXTERNAL_URL: "https://woof-paws-api.onrender.com" });
  assert.equal(deployed.host, "0.0.0.0");
  assert.equal(deployed.port, 10000);
  assert.equal(deployed.trustProxy, 1);
  assert.equal(deployed.publicApiUrl, "https://woof-paws-api.onrender.com");
  assert.throws(() => getHttpSettings({ TRUST_PROXY: "true" }), /TRUST_PROXY/);
  for (const PUBLIC_API_URL of ["http://example.com", "https://user:password@example.com", "https://example.com/api"]) {
    assert.throws(() => getHttpSettings({ NODE_ENV: "production", PUBLIC_API_URL }));
  }
});

test("REST and realtime origin configuration accepts only exact origins", () => {
  assert.deepEqual(getAllowedOrigins({ CORS_ORIGINS: "https://woof-paws.vercel.app, https://other.example" }),
    ["https://woof-paws.vercel.app", "https://other.example"]);
  assert.ok(getAllowedOrigins({ NODE_ENV: "production" }).every(origin => origin.startsWith("https://")));
  for (const CORS_ORIGINS of ["*", "https://example.com/", "https://example.com/path", ", "]) {
    assert.throws(() => getAllowedOrigins({ CORS_ORIGINS }));
  }
});

async function serve(t, options = {}) {
  const app = createApp({ jwtSecret, database: { execute: async () => [[{ ok: 1 }]] }, ...options });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return "http://127.0.0.1:" + server.address().port;
}

test("health checks report DB readiness and do not expose DB errors", async t => {
  const healthy = await serve(t);
  const response = await fetch(healthy + "/health", { headers: { Origin: "https://woof-paws.vercel.app" } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), "https://woof-paws.vercel.app");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { status: "ok" });
  const unavailable = await serve(t, { database: { execute: async () => { throw new Error("private connection details"); } } });
  const failure = await fetch(unavailable + "/health");
  assert.equal(failure.status, 503);
  assert.deepEqual(await failure.json(), { status: "unavailable" });
});

test("auth limits return JSON with retry headers and isolate clients behind the trusted proxy", async t => {
  const origin = await serve(t, {
    httpSettings: getHttpSettings({ TRUST_PROXY: "1" }),
    authRateLimits: createAuthRateLimits({ loginLimit: 2, registrationLimit: 2 }),
  });
  const attempt = (route, forwarded = "198.51.100.10") => fetch(origin + "/users/" + route, {
    method: "POST", headers: { "Content-Type": "application/json", "X-Forwarded-For": forwarded }, body: "{}",
  });
  for (const route of ["login", "register"]) {
    assert.equal((await attempt(route)).status, 400);
    assert.equal((await attempt(route)).status, 400);
    const blocked = await attempt(route);
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get("retry-after")) > 0);
    assert.match((await blocked.json()).message, /Too many/);
    assert.equal((await attempt(route, "198.51.100.11")).status, 400);
    // An attacker prepending a fake address must not change the closest forwarded client.
    assert.equal((await attempt(route, "203.0.113.99, 198.51.100.10")).status, 429);
  }
  assert.equal((await fetch(origin + "/health")).status, 200);
});

test("local mode does not trust forged forwarding headers for rate limits", async t => {
  const origin = await serve(t, {
    authRateLimits: createAuthRateLimits({ loginLimit: 1 }),
  });
  const post = value => fetch(origin + "/users/login", {
    method: "POST", headers: { "Content-Type": "application/json", "X-Forwarded-For": value }, body: "{}",
  });
  // The library warns about unexpected proxy headers; the client still cannot evade the limit.
  t.mock.method(console, "error", () => {});
  assert.equal((await post("198.51.100.10")).status, 400);
  assert.equal((await post("198.51.100.11")).status, 429);
});
