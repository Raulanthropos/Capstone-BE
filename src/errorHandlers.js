export const errorHandler = (err, req, res, next) => {
    console.log(err)
    err
      ? res.status(err.status).send(err)
      : res.status(500).send({ message: "Something went wrong!" });
  };