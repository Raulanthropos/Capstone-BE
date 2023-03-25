import jwt from "jsonwebtoken";
import UsersModel from "../../api/users/model.js"

export const createAccessToken = (payload) =>
//console.log("payload  within the tools:", payload)  log the payload here
new Promise((resolve, reject) =>
    jwt.sign(
      { ...payload },
      process.env.JWT_SECRET,
      { expiresIn: "1h" },
      (err, token) => {
        if (err) reject(err);
        else resolve(token);
      }
    )
  );

  export const createRefreshToken = (payload) =>
  new Promise((resolve, reject) =>
    jwt.sign(
      payload,
      process.env.REFRESH_TOKEN_SECRET,
      { expiresIn: "7d" },
      (err, token) => {
        if (err) reject(err);
        else resolve(token);
      }
    )
  );

  export const verifyAccessToken = (accessToken) =>
  new Promise((res, rej) =>
    jwt.verify(accessToken, process.env.JWT_SECRET, (err, originalPayload) => {
      if (err) rej(err);
      else res({ _id: originalPayload._id, email: originalPayload.email });
    })
  );


export const createTokens = async (user) => {
  console.log("creating tokens");
  const accessToken = await createAccessToken({
    _id: user._id,
    role: user.role,
    email: user.email,
  });
  console.log("accessToken", accessToken);
  const refreshToken = await createRefreshToken({ _id: user._id });
  console.log("refreshToken", refreshToken);
  user.refreshToken = refreshToken;

  await user.save();

  return { accessToken, refreshToken };
};