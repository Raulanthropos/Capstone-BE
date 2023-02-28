// import createHttpError from "http-errors";
// import { verifyAccessToken } from "./tools.js";

// export const JWTAuthMiddleware = async (req, res, next) => {
//   // 1. Check if authorization header is in the request, if it is not --> 401
//   if (!req.headers.authorization) {
//     next(
//       createHttpError(
//         401,
//         "Please provide Bearer Token in the authorization header!"
//       )
//     );
//   } else {
//     try {
//       // 2. If authorization header is there, we should extract the token from it
//       const accessToken = req.headers.authorization.replace("Bearer ", "");

//       // 3. Verify token (check the integrity and check expiration date)
//       const payload = await verifyAccessToken(accessToken);

//       // 4. If everything is fine we should get back the payload and no errors --> next
//       req.user = {
//         _id: payload._id,
//         email: payload.email,
//       };
//       next();
//     } catch (error) {
//       console.log(error);
//       // 5. If token is NOT ok, or in any case jsonwebtoken will throw some error --> 401
//       next(createHttpError(401, "Token not valid!"));
//     }
//   }
// };

import createHttpError from "http-errors";
import { verifyAccessToken } from "./tools.js";

export const JWTAuthMiddleware = async (req, res, next) => {
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

      // 3. Verify token (check the integrity and check expiration date)
      const payload = await verifyAccessToken(accessToken);

      // 4. If everything is fine we should get back the payload and no errors --> next
      req.user = {
        _id: payload._id,
        email: payload.email,
      };
      
      // 5. Check if the user ID in the request path matches the ID of the user associated with the access token
      if (req.params.userId !== req.user._id) {
        next(
          createHttpError(
            401,
            "You are not authorized to perform this action on this user."
          )
        );
      } else {
        next();
      }
      
    } catch (error) {
      console.log(error);
      // 6. If token is NOT ok, or in any case jsonwebtoken will throw some error --> 401
      next(createHttpError(401, "Token not valid!"));
    }
  }
};
