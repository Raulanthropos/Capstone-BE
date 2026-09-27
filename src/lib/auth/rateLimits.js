import { rateLimit } from "express-rate-limit";

export function createAuthRateLimits({ loginLimit = 20, registrationLimit = 10 } = {}) {
  const options = {
    standardHeaders: "draft-8", legacyHeaders: false,
    // One Render instance for the demo; use a shared store before scaling out.
  };
  return {
    login: rateLimit({
      ...options, windowMs: 15 * 60 * 1000, limit: loginLimit, skipSuccessfulRequests: true,
      message: { message: "Too many login attempts. Please try again in 15 minutes." },
    }),
    registration: rateLimit({
      ...options, windowMs: 60 * 60 * 1000, limit: registrationLimit,
      message: { message: "Too many registration attempts. Please try again in one hour." },
    }),
  };
}
