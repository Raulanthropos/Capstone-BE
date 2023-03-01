import mongoose from "mongoose";
import express from "express";
import listEndpoints from "express-list-endpoints";
import q2m from "query-to-mongo";
import DogsModel from "./model.js"
import { JWTAuthMiddleware } from "../../lib/auth/jwtAuth.js";
import createHttpError from "http-errors";
import { createAccessToken } from "../../lib/auth/tools.js";
import multer from "multer";

const dogsRouter = express.Router();

dogsRouter.get("/", async (req, res, next) => {
    try {
      const dogs = await DogsModel.find();
      if (dogs) {
        res.send(dogs);
      } else {
        next(createHttpError(404, `dogs not found`));
      }
    } catch (error) {
      next(error);
    }
  });

    dogsRouter.post("/", async (req, res, next) => {
    try {
      const newDog = new DogsModel(req.body);
      const checkDogName = await DogsModel.findOne({
        name: newDog.name,
      });
      if (checkDogName) {
        next(createHttpError(400, "dogname already in use!"));
      } else {
        const { _id } = await newDog.save();
        res.status(201).send({ _id });
        console.log(`dog with id ${_id} successfully created!`);
      }
    } catch (error) {
      next(error);
    }
  });

export default dogsRouter;