import mongoose from "mongoose";
import express from "express";
import listEndpoints from "express-list-endpoints";
import q2m from "query-to-mongo";
import UsersModel from "./model.js";
import { JWTAuthMiddleware } from "../../lib/auth/jwtAuth.js";
import createHttpError from "http-errors";
import { createAccessToken } from "../../lib/auth/tools.js";

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
        email: newUser.email,
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

  usersRouter.put("/:userId", JWTAuthMiddleware, async (req, res, next) => {
    try {
      const updatedUser = await UsersModel.findByIdAndUpdate(
        req.params.userId,
        req.body,
        { new: true, runValidators: true }
      );
  
      if (updatedUser) {
        res.send(updatedUser);
      } else {
        next(
          createHttpError(404, `user with id ${req.params.userId} not found`)
        );
      }
    } catch (error) {
      next(error);
    }
  });

  usersRouter.delete("/:userId", JWTAuthMiddleware, async (req, res, next) => {
    try {
      const deletedUser = await UsersModel.findByIdAndDelete(
        req.params.userId
      );
  
      if (deletedUser) {
        res.status(204).send();
      } else {
        next(
          createHttpError(404, `user with id ${req.params.userId} not found`)
        );
      }
    } catch (error) {
      next(error);
    }
  });

  //6. REGISTER USER

usersRouter.post("/register", async (req, res, next) => {
  try {
    const { username, email } = req.body

    // Check if the username or email already exists in the database
    const existingUser = await UsersModel.findOne({ $or: [{ username }, { email }] })
    if (existingUser) {
      const existingField = existingUser.username === username ? "username" : "email"
      return res.status(400).send({ message: `user with this ${existingField} already exists` })
    }

    // If the username and email are unique, create the new user
    const newUser = new UsersModel(req.body)
    const { _id } = await newUser.save()

    res.status(201).send({ _id })
  } catch (error) {
    next(error)
  }
})

//7. LOGIN USER

usersRouter.post("/login", async (req, res, next) => {
  try {
    const { email, password } = req.body

    const user = await UsersModel.checkCredentials(email, password)

    if (user) {
      const payload = { _id: user._id }
      const accessToken = await createAccessToken(payload)
      res.send({ accessToken })
    } else {
      next(createHttpError(401, `Credentials are not ok!`))
    }
  } catch (error) {
    next(error)
  }
})

//8. LOGOUT USER

usersRouter.delete("/session", JWTAuthMiddleware, async (req, res, next) => {
  try {
    if (req.user) {
      const user = await UsersModel.updateOne({ id: req.user._id })
      if (user) {
        res.status(200).send({ message: "User logged out" })
      }
    }
  } catch (error) {
    next(error)
  }
})

  export default usersRouter;