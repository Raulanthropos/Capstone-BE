import mongoose from "mongoose";
import { createServer } from "node:http";
import { db } from "./db/index.js";
import { createAccessTokens } from "./lib/auth/accessTokens.js";
import { attachRealtime } from "./lib/realtime.js";
import { createApp } from "./app.js";
import { mysqlPool } from "./db/mysql.js";
import { getHttpSettings } from "./lib/deployment.js";

let server;
let realtime;
let closing;

function closeResources() {
  closing ??= (async () => {
    if (realtime) await realtime.close();
    if (server?.listening) {
      await new Promise((resolve) => server.close(resolve));
    }
    await Promise.all([mysqlPool.end(), mongoose.disconnect()]);
  })();
  return closing;
}

try {
  const httpSettings = getHttpSettings();
  const { host, port } = httpSettings;
  const app = createApp({ httpSettings, onInboxChanged: (ids) => realtime?.publish(ids) });
  await mysqlPool.query("SELECT 1");

  if (process.env.MONGO_URL) {
    try {
      await mongoose.connect(process.env.MONGO_URL, { serverSelectionTimeoutMS: 5000 });
    } catch {
      console.warn("MongoDB is unavailable; legacy endpoints will return 503.");
    }
  } else {
    console.log("MySQL registration, login, profile lookup, dog listing and adoption requests are enabled. Legacy endpoints await migration.");
  }

  server = createServer(app);
  realtime = attachRealtime(server, db, createAccessTokens());
  server.listen(port, host);
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  console.log("API listening at http://" + host + ":" + server.address().port);

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
      closeResources().catch(() => { process.exitCode = 1; });
    });
  }
} catch (error) {
  console.error("Server startup failed:",
    error.code === "INVALID_JWT_SECRET" ? error.message : error.code || error.name);
  await closeResources();
  process.exitCode = 1;
}
