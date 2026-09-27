import jwt from "jsonwebtoken";

const issuer = "woof-paws-api";
const audience = "woof-paws-web";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createAccessTokens(secret = process.env.JWT_SECRET) {
  if (typeof secret !== "string" || Buffer.byteLength(secret.trim(), "utf8") < 32) {
    const error = new Error("JWT_SECRET must contain at least 32 bytes. Run npm run auth:setup.");
    error.code = "INVALID_JWT_SECRET";
    throw error;
  }

  return {
    issue(userId) {
      return jwt.sign({ _id: userId }, secret, {
        algorithm: "HS256", expiresIn: "1h", issuer, audience,
      });
    },
    verify(token) {
      const payload = jwt.verify(token, secret, {
        algorithms: ["HS256"], issuer, audience, maxAge: "1h",
      });
      if (!payload || typeof payload !== "object" || typeof payload._id !== "string" ||
          !uuidPattern.test(payload._id) ||
          !Number.isFinite(payload.exp)) {
        throw new jwt.JsonWebTokenError("Invalid access token claims.");
      }
      return payload._id;
    },
  };
}
