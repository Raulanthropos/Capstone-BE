import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { users } from "../db/schema.ts";
import { allowedOrigins } from "./origins.js";

export function attachRealtime(server, database, accessTokens) {
  const io = new Server(server, {
    cors: { origin: allowedOrigins },
    allowRequest: (req, callback) => callback(null, !req.headers.origin || allowedOrigins.includes(req.headers.origin)),
    maxHttpBufferSize: 16_384,
  });
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    let id;
    const unauthorized = () => { const error = new Error("Authentication required. Please log in again."); error.data = { code: "UNAUTHENTICATED" }; return error; };
    try { if (typeof token !== "string") throw new Error("Missing token"); id = accessTokens.verify(token); }
    catch { return next(unauthorized()); }
    try {
      const [user] = await database.select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1);
      if (!user) return next(unauthorized());
      socket.data.userId = user.id;
      socket.data.expiresAt = jwt.decode(token).exp * 1000;
      next();
    } catch {
      const error = new Error("Messaging is temporarily unavailable.");
      error.data = { code: "SERVICE_UNAVAILABLE" };
      next(error);
    }
  });
  io.on("connection", (socket) => {
    socket.join("user:" + socket.data.userId);
    const expiry = setTimeout(() => {
      socket.emit("session:expired");
      socket.disconnect(true);
    }, Math.max(0, socket.data.expiresAt - Date.now()));
    expiry.unref();
    socket.on("disconnect", () => clearTimeout(expiry));
  });
  return {
    io,
    // Emit only an invalidation signal, never message text or applicant data.
    // HTTP reads always recheck the current account, role and conversation.
    publish(userIds) {
      if (userIds.length) io.to(userIds.map((id) => "user:" + id)).emit("inbox:changed");
    },
    close: () => new Promise((resolve) => io.close(resolve)),
  };
}
