import express from "express";
import bcrypt from "bcrypt";
import multer from "multer";
import { body, validationResult } from "express-validator";
import { db } from "../../db/index.js";
import { users } from "../../db/schema.ts";

const parseFields = multer({
  limits: { fields: 10, parts: 10, fieldSize: 20 * 1024, fieldNameSize: 64 },
}).none();

const registrationValidation = [
  body("name").isString().bail().trim().isLength({ min: 1, max: 100 })
    .withMessage("Name must contain 1 to 100 characters."),
  body("surname").isString().bail().trim().isLength({ min: 1, max: 100 })
    .withMessage("Surname must contain 1 to 100 characters."),
  body("email").isString().bail().trim().isLength({ max: 254 }).bail()
    .isEmail().withMessage("Provide a valid email address.").bail()
    .customSanitizer((value) => value.toLowerCase()),
  body("password").isString().bail().isLength({ min: 8 })
    .withMessage("Password must contain at least 8 characters.").bail()
    .custom((value) => Buffer.byteLength(value, "utf8") <= 72)
    .withMessage("Password must not exceed 72 UTF-8 bytes."),
  body("age").custom((value) =>
    (typeof value === "number" && Number.isInteger(value)) ||
    (typeof value === "string" && /^\d{1,3}$/.test(value))
  ).withMessage("Age must be a whole number.").bail()
    .isInt({ min: 0, max: 130 }).withMessage("Age must be between 0 and 130.").toInt(),
  body("description").isString().bail().trim().isLength({ min: 1, max: 5000 })
    .withMessage("Description must contain 1 to 5000 characters."),
];

export function createRegistrationRouter(registrationDb = db) {
  const router = express.Router();

  router.post("/register", (req, res, next) => {
    if (!req.is("application/json") && !req.is("multipart/form-data")) {
      return res.status(415).json({ message: "Use JSON or multipart/form-data." });
    }

    parseFields(req, res, (error) => {
      if (error) {
        return res.status(400).json({
          message: error.code === "LIMIT_UNEXPECTED_FILE"
            ? "Profile picture uploads are not supported during registration."
            : "Invalid registration form.",
        });
      }
      next();
    });
  }, registrationValidation, async (req, res, next) => {
    const errors = validationResult(req).formatWith(({ param, msg }) => ({
      field: param,
      message: msg,
    }));
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: "Invalid registration details.",
        errors: errors.array({ onlyFirstError: true }),
      });
    }

    try {
      const { name, surname, email, password, age, description } = req.body;
      const passwordHash = await bcrypt.hash(password, 11);
      const [{ id }] = await registrationDb.insert(users).values({
        name, surname, email, passwordHash, age, description,
        // Public registration must never accept a privileged role from the client.
        role: "user",
      }).$returningId();

      res.status(201).json({ _id: id });
    } catch (error) {
      // The unique index also protects against simultaneous registrations.
      if ((error.cause?.code || error.code) === "ER_DUP_ENTRY") {
        return res.status(409).json({ message: "A user with this email already exists." });
      }
      next(error);
    }
  });

  return router;
}
