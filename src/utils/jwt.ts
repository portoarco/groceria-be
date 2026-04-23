import jwt, { sign } from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "supersecret";

export const createToken = (payload: object, expiresIn: any) => {
  const token = sign(payload, JWT_SECRET, { expiresIn });
};

export const verifyToken = (token: string) => {
  return jwt.verify(token, JWT_SECRET);
};
