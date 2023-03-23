import createHttpError from "http-errors";

export const adminOnlyMiddleware = (req, res, next) => {
  console.log("req.user.role:", req.user.role);
  if (req.user.role === "admin") {
    next();
  } else {
    next(createHttpError(403, "This endpoint is available just for admins!"));
  }
};