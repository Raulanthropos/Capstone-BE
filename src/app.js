import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import { createRegistrationRouter } from "./api/users/register.js";
import usersRouter from "./api/users/index.js";
import dogsRouter from "./api/dogs/index.js";
import adoptionRouter from "./api/adoptions/index.js";
import {
  badRequestHandler,
  forbiddenHandler,
  genericErrorHandler,
  unauthorizedHandler,
  notFoundHandler,
} from "./errorHandlers.js";

export function createApp({ registrationDb } = {}) {
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
  app.use("/users", createRegistrationRouter(registrationDb));

  app.use(["/users", "/dogs", "/adoptions"], (req, res, next) => {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ message: "This feature is temporarily unavailable." });
    }
    next();
  });
  app.use("/users", usersRouter);
  app.use("/dogs", dogsRouter);
  app.use("/adoptions", adoptionRouter);

  app.use((req, res) => res.status(404).json({ message: "Endpoint not found." }));
  app.use(badRequestHandler);
  app.use(forbiddenHandler);
  app.use(unauthorizedHandler);
  app.use(notFoundHandler);
  app.use(genericErrorHandler);

  return app;
}
