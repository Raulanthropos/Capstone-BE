import express from "express";
import cors from "cors";
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

export function createApp({ database = db, jwtSecret = process.env.JWT_SECRET } = {}) {
  const accessTokens = createAccessTokens(jwtSecret);
  const app = express();

  app.use(cors({ origin: [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "https://woof-paws-raulanthropos.vercel.app",
    "https://woof-paws.vercel.app",
  ] }));
  app.use(express.json({ limit: "64kb" }));
  app.use(express.static("public"));

  // Migrated routes are available without a MongoDB connection.
  app.use("/users", createRegistrationRouter(database));
  app.use("/users", createAuthenticationRouter(database, accessTokens));
  app.use("/dogs", createDogListingRouter(database));
  app.use("/adoptions", createAdoptionRequestsRouter(database, accessTokens));
  app.use("/adoptions", createAdoptionReviewRouter(database, accessTokens));

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
