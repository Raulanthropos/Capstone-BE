import mongoose from "mongoose";
import { createApp } from "./app.js";
import { mysqlPool } from "./db/mysql.js";

const port = Number(process.env.PORT ?? 3001);
const host = process.env.API_HOST || "127.0.0.1";
let server;
let closing;

function closeResources() {
  closing ??= (async () => {
    if (server?.listening) {
      await new Promise((resolve) => server.close(resolve));
    }
    await Promise.all([mysqlPool.end(), mongoose.disconnect()]);
  })();
  return closing;
}

try {
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("PORT must be an integer between 0 and 65535.");
  }
  await mysqlPool.query("SELECT 1");

  if (process.env.MONGO_URL) {
    try {
      await mongoose.connect(process.env.MONGO_URL, { serverSelectionTimeoutMS: 5000 });
    } catch {
      console.warn("MongoDB is unavailable; legacy endpoints will return 503.");
    }
  } else {
    console.log("MySQL registration is enabled. Legacy endpoints await migration.");
  }

  server = createApp().listen(port, host);
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
  console.error("Server startup failed:", error.code || error.name);
  await closeResources();
  process.exitCode = 1;
}
