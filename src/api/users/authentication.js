import express from "express";
import bcrypt from "bcrypt";
import { eq } from "drizzle-orm";
import { body, validationResult } from "express-validator";
import { users } from "../../db/schema.ts";

// Compare even when an email is unknown, using the same cost as registration.
const dummyPasswordHash = "$2b$11$IwcWRvt8yMHgVa0rhx0tVeQ2TPNcPQuJ4ejxugyZMWwz1UZGIRzgy";

// Explicit projection preserves the frontend contract and excludes password hashes.
const publicUserFields = {
  _id: users.id,
  name: users.name,
  surname: users.surname,
  age: users.age,
  email: users.email,
  picture: users.picture,
  role: users.role,
  description: users.description,
};

const loginValidation = [
  body("email").isString().bail().trim().isLength({ max: 254 }).bail()
    .isEmail().withMessage("Provide a valid email address.").bail()
    .customSanitizer((value) => value.toLowerCase()),
  body("password").isString().bail().isLength({ min: 1 })
    .withMessage("Password is required.").bail()
    .custom((value) => Buffer.byteLength(value, "utf8") <= 72)
    .withMessage("Password must not exceed 72 UTF-8 bytes."),
];

export function createAuthenticationRouter(database, accessTokens) {
  const router = express.Router();

  router.post("/login", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (!req.is("application/json")) {
      return res.status(415).json({ message: "Use application/json." });
    }
    next();
  }, loginValidation, async (req, res, next) => {
    const errors = validationResult(req).formatWith(({ param, msg }) => ({
      field: param, message: msg,
    }));
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: "Invalid login details.",
        errors: errors.array({ onlyFirstError: true }),
      });
    }

    try {
      const [row] = await database.select({ ...publicUserFields, passwordHash: users.passwordHash })
        .from(users).where(eq(users.email, req.body.email)).limit(1);
      const passwordMatches = await bcrypt.compare(req.body.password, row?.passwordHash ?? dummyPasswordHash);
      if (!row || !passwordMatches) {
        return res.status(401).json({ message: "Invalid email or password." });
      }
      const { passwordHash, ...user } = row;
      res.json({ user, accessToken: accessTokens.issue(user._id) });
    } catch (error) {
      next(error);
    }
  });

  router.get("/me", async (req, res, next) => {
    res.set("Cache-Control", "no-store");
    const unauthorized = () => res.status(401)
      .set("WWW-Authenticate", "Bearer")
      .json({ message: "Authentication required. Please log in again." });
    const match = req.headers.authorization?.match(/^Bearer ([^\s]+)$/i);
    if (!match) return unauthorized();

    let userId;
    try {
      userId = accessTokens.verify(match[1]);
    } catch {
      return unauthorized();
    }

    try {
      const [user] = await database.select(publicUserFields)
        .from(users).where(eq(users.id, userId)).limit(1);
      if (!user) return unauthorized();
      res.json(user);
    } catch (error) {
      // A database outage is a server error, not an invalid token.
      next(error);
    }
  });

  return router;
}
