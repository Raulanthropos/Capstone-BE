import mongoose from "mongoose";
import express from "express";
import listEndpoints from "express-list-endpoints";
import q2m from "query-to-mongo";
import UsersModel from "./model.js";
import { JWTAuthMiddleware } from "../../lib/auth/jwtAuth.js";
import { adminOnlyMiddleware } from "../../lib/auth/adminOnly.js";
import { createAccessToken } from "../../lib/auth/tools.js";
import createHttpError from "http-errors";

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

usersRouter.get("/me", JWTAuthMiddleware, async (req, res, next) => {
try {
  const user = await UsersModel.findById(req.user._id);
  if (!user) {
    return next(createHttpError(404, "User not found"));
  }
  res.send(user);
} catch (error) {
  next(error);
}
});

usersRouter.get('/:userId', JWTAuthMiddleware, adminOnlyMiddleware, async (req, res, next) => {
  try {
    const user = await UsersModel.findById(req.params.userId);
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

//8. LOGOUT USER

usersRouter.delete("/session", JWTAuthMiddleware, async (req, res, next) => {
  try {
    console.log("This is the req.user when we access the try block", req.user)
    if (req.user) {
      console.log("This is the req.user inside the if statement", req.user)
      const user = await UsersModel.findOneAndUpdate(
        { _id: req.user._id },
        { $unset: { accessToken: 1 } },
        { new: true, runValidators: true }
      )
      if (user.isModified) {
        res.status(200).send({ message: "User logged out" })
      } else {
        res.status(400).send({ message: "User not found" })
      }
    }
  } catch (error) {
    next(error)
  }
})

usersRouter.delete("/:userId", JWTAuthMiddleware, async (req, res, next) => {
  try {
    const deletedUser = await UsersModel.findByIdAndDelete(
      req.user._id
    );

    if (deletedUser) {
      res.status(204).send();
    } else {
      next(
        createHttpError(404, `user with id ${req.user._id} not found`)
      );
    }
  } catch (error) {
    next(error);
  }
});


usersRouter.post("/login", async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const user = await UsersModel.checkCredentials(email, password);
    if (!user) {
      return next(createHttpError(401, "Invalid email or password"));
    }

    const payload = { _id: user._id, email: user.email };
    const accessToken = await createAccessToken(payload);

    res.send({ user: user.toJSON(), accessToken });
  } catch (error) {
    next(error);
  }
});


  export default usersRouter;
