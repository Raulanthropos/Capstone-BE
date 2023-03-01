import express from "express";
import listEndpoints from "express-list-endpoints";
import cors from "cors";
import mongoose from "mongoose";
import usersRouter from "./api/users/index.js";
import dogsRouter from "./api/dogs/index.js";
import { errorHandler } from "./errorHandlers.js";

const server = express();
const port = process.env.PORT;

server.use(cors(process.env.FE_URL));
server.use(express.json());

// endpoints
server.use("/users", usersRouter);
server.use("/dogs", dogsRouter);

server.use(errorHandler);

mongoose.connect(process.env.MONGO_URL);

//---

mongoose.connection.on("connected", () => {
  console.log("successfully connected to Mongo!");
  server.listen(port, () => {
    console.table(listEndpoints(server));
    console.log(`Server is running on port ${port}`);
  });
});
