import mongoose from "mongoose";
import express from "express";
import listEndpoints from "express-list-endpoints";
import q2m from "query-to-mongo";
import UsersModel from "./model.js";
import { JWTAuthMiddleware } from "../../lib/auth/jwtAuth.js";
import createHttpError from "http-errors";
import { createAccessToken } from "../../lib/auth/tools.js";
import { adminOnlyMiddleware } from "../../lib/auth/adminOnly.js";
import multer from "multer";
import checkCredentials from "./model.js"

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

  usersRouter.get('/:id', async (req, res, next) => {
    try {
      const user = await UsersModel.findById(req.params.id);
      if (user) {
        res.send(user);
      } else {
        next(createHttpError(404, 'user not found'));
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

  usersRouter.delete("/:userId", async (req, res, next) => {
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

usersRouter.post("/register", multer().fields(["name", "surname", "email", "password", "age", "description", "picture"]) ,async (req, res, next) => {
  try {
    const { email } = req.body

    // Check if the email already exists in the database
    const existingUser = await UsersModel.findOne({ email });
    if (existingUser) {
      const existingField = existingUser.email === email ? "email" : "unique"
      return res.status(400).send({ message: `user with this ${existingField} already exists` })
    }

    // If the email is unique, create the new user
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
      res.send({ user, accessToken })
    } else {
      next(createHttpError(401, `Credentials are not ok!`))
    }
  } catch (error) {
    next(error)
  }
})


//8. LOGOUT USER

usersRouter.delete("/session", async (req, res, next) => {
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