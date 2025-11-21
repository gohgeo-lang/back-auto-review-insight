import { prisma } from "../lib/prisma";
import bcrypt from "bcrypt";

export const registerUser = async (email: string, password: string) => {
  const hashed = await bcrypt.hash(password, 10);

  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) return res.status(400).json({ error: "EMAIL_EXISTS" });

  const user = await prisma.user.create({
    data: {
      email,
      password: hashed,
    },
  });

  return user;
};

export const findUserByEmail = async (email: string) => {
  return prisma.user.findUnique({
    where: { email },
  });
};
