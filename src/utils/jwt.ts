import jwt, { sign } from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "supersecret";

export const signToken = (payload: object, expiresIn: any) => {
  const token = sign(payload, JWT_SECRET, { expiresIn });
  return token;
};

export const verifyToken = (token: string) => {
  return jwt.verify(token, JWT_SECRET);
};
