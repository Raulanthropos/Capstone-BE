import mongoose from "mongoose";
import express from "express";
import listEndpoints from "express-list-endpoints";
import q2m from "query-to-mongo";
import UsersModel from "./model.js";
import { JWTAuthMiddleware } from "../../lib/auth/jwtAuth.js";
import { adminOnlyMiddleware } from "../../lib/auth/adminOnly.js";
import { createAccessToken } from "../../lib/auth/tools.js";
import createHttpError from "http-errors";
import multer from "multer";
import checkCredentials from "./model.js"
import path from "path";

const usersRouter = express.Router();

// Set up multer storage
const storage = multer.diskStorage({
  destination: "./public/images",
  filename: function (req, file, cb) {
    cb(null, file.fieldname + "-" + Date.now() + path.extname(file.originalname));
  },
});

// Set up multer upload
const upload = multer({
  storage: storage,
  limits: { fileSize: 100000000 },
}).single("picture");

// const upload = multer({ dest: "uploads/" });

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


usersRouter.post("/register", async (req, res, next) => {
  try {
    upload(req, res, async (err) => {
      if (err) {
        return res.status(400).json({ message: err.message });
      }
      const { email } = req.body;
      const { name, surname, password, age, description } = req.body;

      // Check if the email already exists in the database
      const existingUser = await UsersModel.findOne({ email });
      if (existingUser) {
        const existingField = existingUser.email === email ? "email" : "unique";
        return res.status(400).send({ message: `user with this ${existingField} already exists` });
      }

      // If the email is unique, create the new user
      const newUser = new UsersModel({
        name,
        surname,
        email,
        password,
        age,
        description,
        picture: req.file ? req.file.path : "https://images.unsplash.com/photo-1506748686214-e9df14d4d9d0?ixlib=rb-4.0.3&ixid=MnwxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8&auto=format&fit=crop&w=687&q=80",
      });

      const { _id } = await newUser.save();
      res.status(201).send({ _id });
    });
  } catch (error) {
    next(error);
  }
});

  //6. REGISTER USER

// usersRouter.post("/register", multer().fields(["name", "surname", "email", "password", "age", "description", "picture"]) ,async (req, res, next) => {
//   try {
//     const { email } = req.body

//     // Check if the email already exists in the database
//     const existingUser = await UsersModel.findOne({ email });
//     if (existingUser) {
//       const existingField = existingUser.email === email ? "email" : "unique"
//       return res.status(400).send({ message: `user with this ${existingField} already exists` })
//     }

//     // If the email is unique, create the new user
//     const newUser = new UsersModel(req.body)
//     const { _id } = await newUser.save()

//     res.status(201).send({ _id })
//   } catch (error) {
//     next(error)
//   }
// })

//7. LOGIN USER

// usersRouter.post("/login", async (req, res, next) => {
//   try {
//     const { email, password } = req.body

//     const user = await UsersModel.checkCredentials(email, password)
//     console.log("This is mein body", req.body);
//     if (user) {
//       const payload = { _id: user._id, email: user.email }
//       console.log("Payload", payload)
//       const accessToken = await createAccessToken(payload)
//       console.log("I am the accessToken", accessToken);
//       res.send({ user, accessToken });
//     } else {
//       next(createHttpError(401, `Credentials are not ok!`))
//     }
//   } catch (error) {
//     next(error)
//   }
// })

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