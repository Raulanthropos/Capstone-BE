import express from "express";
import adoptionModel from "./model.js";
import { JWTAuthMiddleware } from "../../lib/auth/jwtAuth.js";
import { adminOnlyMiddleware } from "../../lib/auth/adminOnly.js";
// import createHttpError from "http-errors";

const adoptionRouter = express.Router();

adoptionRouter.get("/", JWTAuthMiddleware, adminOnlyMiddleware, async (req, res) => {
  try {
    const adoptions = await adoptionModel.find().populate("user").populate("dog");
    console.log("adoption requests", adoptions);
    res.send(adoptions);
  } catch (error) {
    res.status(500).send(error);
  }
});

export default adoptionRouter;
