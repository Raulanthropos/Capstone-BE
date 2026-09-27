import mongoose from "mongoose";

export const badRequestHandler = (err, req, res, next) => {
  if (err.type === "entity.parse.failed") {
    res.status(400).json({ message: "Invalid JSON body." });
  } else if (err.status === 400 || err instanceof mongoose.Error.ValidationError) {
    res.status(400).send({ message: err.message });
  } else if (err instanceof mongoose.Error.CastError) {
    res
      .status(400)
      .send({ message: "You've sent a wrong _id in the request parameters." });
  } else {
    next(err);
  }
};

export const unauthorizedHandler = (err, req, res, next) => {
  if (err.status === 401) {
    res.status(401).send({ message: err.message });
  } else {
    next(err);
  }
};

export const forbiddenHandler = (err, req, res, next) => {
  if (err.status === 403) {
    res.status(403).send({ message: err.message });
  } else {
    next(err);
  }
};

export const notFoundHandler = (err, req, res, next) => {
  if (err.status === 404) {
    res.status(404).send({ message: err.message });
  } else {
    next(err);
  }
};

export const genericErrorHandler = (err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }
  const status = err.status || 500;
  if (status >= 500) {
    // Database errors can contain SQL parameters, including password hashes.
    console.error("Request failed:", err.cause?.code || err.code || err.name);
  }
  res.status(status).json({
    message: status >= 500 ? "An unexpected error occurred." : err.message,
  });
};
