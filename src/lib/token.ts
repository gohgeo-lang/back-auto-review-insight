import jwt from "jsonwebtoken";

export function signToken(id: string, email: string) {
  return jwt.sign({ id, email }, process.env.JWT_SECRET || "dev-secret", {
    expiresIn: "7d",
  });
}
