import { readFileSync } from "node:fs";

export function getMysqlConfig(env = process.env) {
  const required = ["DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD"];
  const missing = required.filter((name) => !env[name]);
  if (missing.length) throw new Error("Missing MySQL configuration: " + missing.join(", "));
  const port = Number(env.DB_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("DB_PORT must be an integer between 1 and 65535.");
  }
  const ssl = env.DB_SSL || "false";
  if (!["true", "false"].includes(ssl)) throw new Error("DB_SSL must be true or false.");
  if (env.NODE_ENV === "production" && ssl !== "true") {
    throw new Error("Production MySQL connections require DB_SSL=true.");
  }
  if (env.DB_SSL_CA_PATH && ssl !== "true") throw new Error("DB_SSL_CA_PATH requires DB_SSL=true.");
  let ca;
  if (env.DB_SSL_CA_PATH) {
    ca = readFileSync(env.DB_SSL_CA_PATH, "utf8");
    if (!ca.includes("-----BEGIN CERTIFICATE-----")) throw new Error("Invalid MySQL CA certificate.");
  }
  return {
    host: env.DB_HOST, port, database: env.DB_NAME,
    user: env.DB_USER, password: env.DB_PASSWORD,
    ...(ssl === "true" ? { ssl: { rejectUnauthorized: true, verifyIdentity: true, ...(ca ? { ca } : {}) } } : {}),
  };
}
