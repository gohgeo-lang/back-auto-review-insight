import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";

export const authMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const header = req.headers.authorization;

  if (!header) {
    return res.status(401).json({ error: "TOKEN_MISSING" });
  }

  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ error: "INVALID_FORMAT" });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as {
      id: string;
      email: string;
    };

    (req as any).user = {
      id: decoded.id,
      email: decoded.email,
    };

    next();
  } catch (error) {
    console.error("[authMiddleware] JWT Error:", error);
    return res.status(401).json({ error: "INVALID_TOKEN" });
  }
};
