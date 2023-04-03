import express from "express";
import adoptionModel from "./model.js";
import { JWTAuthMiddleware } from "../../lib/auth/jwtAuth.js";
import { adminOnlyMiddleware } from "../../lib/auth/adminOnly.js";
import createHttpError from "http-errors";

const adoptionRouter = express.Router();

adoptionRouter.get("/", JWTAuthMiddleware, adminOnlyMiddleware, async (req, res) => {
  try {
    // console.log("This is the request", req)
    const adoptions = await adoptionModel.find().populate("user").populate("dog");
    console.log("adoption requests", adoptions);
    res.send(adoptions);
  } catch (error) {
    res.status(500).send(error);
  }
});

adoptionRouter.post("/", JWTAuthMiddleware, async (req, res) => {
  try {
    const { user, dog } = req.body;
    const adoption = new adoptionModel({ user, dog });
    const result = await adoption.save();
    res.send(result);
  } catch (error) {
    res.status(500).send(error);
  }
});

export default adoptionRouter;
