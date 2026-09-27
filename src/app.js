import express from "express";
import cors from "cors";
import { sql } from "drizzle-orm";
import { getHttpSettings } from "./lib/deployment.js";
import { createAuthRateLimits } from "./lib/auth/rateLimits.js";
import { allowedOrigins } from "./lib/origins.js";
import { createInboxRouter } from "./api/inbox/index.js";
import mongoose from "mongoose";
import { createRegistrationRouter } from "./api/users/register.js";
import { createAuthenticationRouter } from "./api/users/authentication.js";
import { createAccessTokens } from "./lib/auth/accessTokens.js";
import { db } from "./db/index.js";
import usersRouter from "./api/users/index.js";
import dogsRouter from "./api/dogs/index.js";
import { createDogListingRouter } from "./api/dogs/list.js";
import { createAdoptionReviewRouter } from "./api/adoptions/index.js";
import { createAdoptionRequestsRouter } from "./api/adoptions/requests.js";
import {
  badRequestHandler,
  forbiddenHandler,
  genericErrorHandler,
  unauthorizedHandler,
  notFoundHandler,
} from "./errorHandlers.js";

export function createApp({ database = db, jwtSecret = process.env.JWT_SECRET, onInboxChanged = () => {},
  httpSettings = getHttpSettings(), authRateLimits = createAuthRateLimits() } = {}) {
  const accessTokens = createAccessTokens(jwtSecret);
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", httpSettings.trustProxy);

  app.use(cors({ origin: allowedOrigins }));
  app.use("/users", (req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
  app.post("/users/login", authRateLimits.login);
  app.post("/users/register", authRateLimits.registration);
  app.use(express.json({ limit: "64kb" }));
  app.use(express.static("public"));

  app.get("/health", async (req, res) => {
    res.set("Cache-Control", "no-store");
    let timeout;
    try {
      await Promise.race([
        database.execute(sql`SELECT 1`),
        new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error("Health check timeout")), 4000); }),
      ]);
      res.json({ status: "ok" });
    } catch {
      res.status(503).json({ status: "unavailable" });
    } finally { clearTimeout(timeout); }
  });

  // Migrated routes are available without a MongoDB connection.
  app.use("/users", createRegistrationRouter(database));
  app.use("/users", createAuthenticationRouter(database, accessTokens));
  app.use("/dogs", createDogListingRouter(database, { publicApiUrl: httpSettings.publicApiUrl }));
  app.use("/adoptions", createAdoptionRequestsRouter(database, accessTokens, onInboxChanged));
  app.use("/adoptions", createAdoptionReviewRouter(database, accessTokens, onInboxChanged));
  app.use("/inbox", createInboxRouter(database, accessTokens, onInboxChanged));

  app.use(["/users", "/dogs"], (req, res, next) => {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ message: "This feature is temporarily unavailable." });
    }
    next();
  });
  app.use("/users", usersRouter);
  app.use("/dogs", dogsRouter);

  app.use((req, res) => res.status(404).json({ message: "Endpoint not found." }));
  app.use(badRequestHandler);
  app.use(forbiddenHandler);
  app.use(unauthorizedHandler);
  app.use(notFoundHandler);
  app.use(genericErrorHandler);

  return app;
}
