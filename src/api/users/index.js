import mongoose from "mongoose";
import express from "express";
import listEndpoints from "express-list-endpoints";
import q2m from "query-to-mongo";
import UsersModel from "./model.js";

const usersRouter = express.Router();

usersRouter.get("/", async (req, res, next) => {
    try {
      const users = await UsersModel.find();
      if (users) {
        res.send(users);
      } else {
        next(createHttpError(404, `users not found`));
      }
    } catch (error) {
      next(error);
    }
  });

  usersRouter.post("/", async (req, res, next) => {
    try {
      const newUser = new UsersModel(req.body);
      const checkUsername = await UsersModel.findOne({
        username: newUser.username,
      });
      if (checkUsername) {
        next(createHttpError(400, "username already in use!"));
      } else {
        const { _id } = await newUser.save();
        res.status(201).send({ _id });
        console.log(`user with id ${_id} successfully created!`);
      }
    } catch (error) {
      next(error);
    }
  });

  export default usersRouter;