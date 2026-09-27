import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv, promisify } from "node:util";
import { test } from "node:test";
import { createAccessTokens } from "../src/lib/auth/accessTokens.js";

const run = promisify(execFile);
const script = fileURLToPath(new URL("../scripts/setup-auth.js", import.meta.url));

async function temporaryDirectory(t) {
  const path = await mkdtemp(join(tmpdir(), "woof-paws-auth-"));
  t.after(async () => {
    const target = resolve(path);
    assert.equal(dirname(target), resolve(tmpdir()));
    assert.match(basename(target), /^woof-paws-auth-/);
    await rm(target, { recursive: true, force: true });
  });
  return path;
}

test("auth setup generates a private secret, preserves DB config, and is safe to rerun", async (t) => {
  const cwd = await temporaryDirectory(t);
  const path = join(cwd, ".env");
  await writeFile(path, "# Keep this comment\r\nDB_PORT=3307\r\nJWT_SECRET=\r\n");
  const first = await run(process.execPath, [script], { cwd, windowsHide: true });
  const contents = await readFile(path, "utf8");
  const { JWT_SECRET: secret, DB_PORT: port } = parseEnv(contents);
  assert.match(secret, /^[0-9a-f]{64}$/);
  assert.equal(port, "3307");
  assert.ok(contents.startsWith("# Keep this comment\r\n"));
  assert.ok(!(first.stdout + first.stderr).includes(secret));
  const second = await run(process.execPath, [script], { cwd, windowsHide: true });
  assert.match(second.stdout, /already configured/);
  assert.equal(await readFile(path, "utf8"), contents);
});

test("auth setup appends a secret when upgrading an existing environment file", async (t) => {
  const cwd = await temporaryDirectory(t);
  const path = join(cwd, ".env");
  await writeFile(path, "DB_PORT=3307");
  await run(process.execPath, [script], { cwd, windowsHide: true });
  const contents = await readFile(path, "utf8");
  assert.ok(contents.startsWith("DB_PORT=3307\nJWT_SECRET="));
  assert.match(parseEnv(contents).JWT_SECRET, /^[0-9a-f]{64}$/);
});

test("auth setup does not overwrite an existing weak secret or create a missing .env", async (t) => {
  const cwd = await temporaryDirectory(t);
  const path = join(cwd, ".env");
  await assert.rejects(run(process.execPath, [script], { cwd, windowsHide: true }), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /Create .env from .env.example/);
    return true;
  });
  await assert.rejects(readFile(path), { code: "ENOENT" });
  await writeFile(path, "JWT_SECRET=too-short\n");
  await assert.rejects(run(process.execPath, [script], { cwd, windowsHide: true }), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /Existing JWT_SECRET is too short/);
    return true;
  });
  assert.equal(await readFile(path, "utf8"), "JWT_SECRET=too-short\n");
});

test("access tokens require a configured secret instead of an insecure fallback", () => {
  for (const secret of ["", "short", " ".repeat(64), null]) {
    assert.throws(() => createAccessTokens(secret), { code: "INVALID_JWT_SECRET" });
  }
});
