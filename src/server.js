import express from "express";
import listEndpoints from "express-list-endpoints";
import cors from "cors";
import mongoose from "mongoose";
import usersRouter from "./api/users/index.js";
import dogsRouter from "./api/dogs/index.js";
import {
  badRequestHandler,
  forbiddenHandler,
  genericErrorHandler,
  unauthorizedHandler,
  notFoundHandler,
} from "./errorHandlers.js";
import dotenv from "dotenv";
dotenv.config();

const server = express();
const port = process.env.PORT;

const whitelist = [process.env.FE_URL, process.env.FE_URL_PROD];

const corsOptions = {
  origin: function (origin, callback) {
    if (whitelist.indexOf(origin) !== -1) {
      callback(null, true)
    } else {
      callback(new Error('Not allowed by CORS'))
    }
  }
};


server.use(cors(corsOptions));
server.use(express.json());

// endpoints
server.use("/users", usersRouter);
server.use("/dogs", dogsRouter);

server.use(badRequestHandler);
server.use(forbiddenHandler);
server.use(genericErrorHandler);
server.use(unauthorizedHandler);
server.use(notFoundHandler);

mongoose.connect(process.env.MONGO_URL);

//---

mongoose.connection.on("connected", () => {
  console.log("successfully connected to Mongo!");
  server.listen(port, () => {
    console.table(listEndpoints(server));
    console.log(`Server is running on port ${port}`);
  });
});
