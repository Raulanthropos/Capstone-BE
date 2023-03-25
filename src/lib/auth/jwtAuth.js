import createHttpError from "http-errors";
import { verifyAccessToken } from "./tools.js";
import UsersModel from "../../api/users/model.js";

export const JWTAuthMiddleware = async (req, res, next) => {
  console.log("JWTAuthMiddleware called")
  // 1. Check if authorization header is in the request, if it is not --> 401
  if (!req.headers.authorization) {
    next(
      createHttpError(
        401,
        "Please provide Bearer Token in the authorization header!"
      )
    );
  } else {
    try {
      // 2. If authorization header is there, we should extract the token from it
      const accessToken = req.headers.authorization.replace("Bearer ", "");
      console.log("accessToken within the jwt", accessToken);
      // 3. Verify token (check the integrity and check expiration date)
      const payload = await verifyAccessToken(accessToken);
      console.log("payload within the jwt", payload);
      // 4. If everything is fine we should get back the payload and no errors --> next
      req.user = {
        _id: payload._id,
        email: payload.email,
      };

      // 5. Check if the user ID in the payload matches the ID of the user associated with the access token
      const user = await UsersModel.findById(req.user._id);
      console.log("Dis is the user, maybe the broblem lies here", user);
      if (!user) {
        return next(createHttpError(404, "User not found"));
      }
      if (payload._id !== user._id.toString()) {
        return next(
          createHttpError(
            401,
            "You are not authorized to perform this action on this user."
          )
        );
      }

      // 6. Set the role property based on the user's role property
      req.user.role = user.role;
      req.user._id = user.id;
      // 6. If the user is authorized, call the next middleware/handler
      console.log("Middleware completed successfully");
      next();

    } catch (error) {
      console.log("This is where we get", error);
      // 7. If token is NOT ok, or in any case jsonwebtoken will throw some error --> 401
      next(createHttpError(401, "Token not valid!"));
    }
  }
};

