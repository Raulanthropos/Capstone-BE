import jwt from "jsonwebtoken";
import UsersModel from "../../api/users/model.js"

export const createAccessToken = (payload) =>
  new Promise((resolve, reject) =>
    jwt.sign(
      payload,
      process.env.JWT_SECRET,
      { expiresIn: "1 week" },
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
      else res(originalPayload);
    })
  );

export const createTokens = async (user) => {
  console.log("creating tokens");
  const accessToken = await createAccessToken({
    _id: user._id,
    role: user.role,
  });
  console.log("accessToken", accessToken);
  const refreshToken = await refreshToken({ _id: user._id });
  console.log("refreshToken", refreshToken);
  user.refreshToken = refreshToken;

  await user.save();

  return { accessToken, refreshToken };
};