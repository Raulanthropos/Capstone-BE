import { eq } from "drizzle-orm";
import { users } from "../../db/schema.ts";
import { publicUserFields } from "../../api/users/publicFields.js";

export function authenticationRequired(res) {
  return res.status(401).set("WWW-Authenticate", "Bearer")
    .json({ message: "Authentication required. Please log in again." });
}

export function requireUser(database, accessTokens) {
  return async (req, res, next) => {
    res.set("Cache-Control", "no-store");
    const match = req.headers.authorization?.match(/^Bearer ([^\s]+)$/i);
    if (!match) return authenticationRequired(res);

    let userId;
    try {
      userId = accessTokens.verify(match[1]);
    } catch {
      return authenticationRequired(res);
    }

    try {
      const [user] = await database.select(publicUserFields)
        .from(users).where(eq(users.id, userId)).limit(1);
      if (!user) return authenticationRequired(res);
      req.user = user;
      next();
    } catch (error) {
      // A database outage is a server error, not an invalid token.
      next(error);
    }
  };
}
