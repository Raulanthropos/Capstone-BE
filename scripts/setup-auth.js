import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { createAccessTokens } from "../src/lib/auth/accessTokens.js";

try {
  const contents = await readFile(".env", "utf8");
  const { JWT_SECRET: existingSecret } = parseEnv(contents);
  if (existingSecret?.trim()) {
    createAccessTokens(existingSecret);
    console.log("JWT_SECRET is already configured; .env was not changed.");
  } else {
    const entry = "JWT_SECRET=" + randomBytes(32).toString("hex");
    const assignment = /^[\t ]*(?:export[\t ]+)?JWT_SECRET[\t ]*=.*$/gm;
    const updated = assignment.test(contents)
      ? contents.replace(assignment, entry)
      : contents + (contents.endsWith("\n") ? "" : "\n") + entry + "\n";
    await writeFile(".env", updated, { mode: 0o600 });
    console.log("Added a random JWT_SECRET to .env. Restart the API to load it.");
  }
} catch (error) {
  console.error(error.code === "ENOENT"
    ? "Create .env from .env.example before running npm run auth:setup."
    : error.code === "INVALID_JWT_SECRET"
      ? "Existing JWT_SECRET is too short; .env was not changed. Remove that value and rerun npm run auth:setup."
      : "Could not configure JWT_SECRET: " + (error.code || error.name));
  process.exitCode = 1;
}
