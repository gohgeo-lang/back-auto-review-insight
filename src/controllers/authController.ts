import { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import bcrypt from "bcrypt";
import { signToken } from "../lib/token";

export const signup = async (req: Request, res: Response) => {
  const { email, password, storeName } = req.body;

  const hashed = await bcrypt.hash(password, 10);

  const user = await prisma.user.create({
    data: { email, password: hashed, storeName },
  });

  return res.json(user);
};

export const login = async (req: Request, res: Response) => {
  const { email, password } = req.body;

  const user = await prisma.user.findUnique({
    where: { email },
  });

  if (!user) return res.status(400).json({ error: "No user" });

  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.status(400).json({ error: "Wrong password" });

  const token = signToken(user.id);

  return res.json({ token, user });
};

export const setStoreUrl = async (req: Request, res: Response) => {
  const { userId, storeUrl } = req.body;

  const user = await prisma.user.update({
    where: { id: userId },
    data: { storeUrl },
  });

  res.json(user);
};
