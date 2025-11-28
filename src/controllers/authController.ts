import { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import bcrypt from "bcrypt";
import { signToken } from "../lib/token";

export const signup = async (req: Request, res: Response) => {
  try {
    const { email, password, storeName, name, nickname, gender, address } = req.body;

    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) return res.status(400).json({ error: "EMAIL_EXISTS" });

    const hashed = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: { email, password: hashed, storeName, name, nickname, gender, address },
    });

    const { password: pw, ...safeUser } = user;
    const token = signToken(user.id, user.email);

    return res.json({ token, user: safeUser });
  } catch (err) {
    console.error("Signup Error", err);
    return res.status(500).json({ error: "SIGNUP_FAILED" });
  }
};

export const login = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) return res.status(400).json({ error: "USER_NOT_FOUND" });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(400).json({ error: "WRONG_PASSWORD" });

    const token = signToken(user.id, user.email);
    const { password: pw, ...safeUser } = user;

    return res.json({ token, user: safeUser });
  } catch (err) {
    console.error("Login Error", err);
    return res.status(500).json({ error: "LOGIN_FAILED" });
  }
};

// 현재 사용자 정보 조회
export const me = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        nickname: true,
        gender: true,
        address: true,
        plan: true,
        storeName: true,
        storeUrl: true,
        placeId: true,
        createdAt: true,
        onboarded: true,
      },
    });
    if (!user) return res.status(404).json({ error: "USER_NOT_FOUND" });
    return res.json(user);
  } catch (err) {
    console.error("me Error", err);
    return res.status(500).json({ error: "ME_FAILED" });
  }
};

// storeUrl 업데이트 (보호 필요 O)
export const setStoreUrl = async (req: Request, res: Response) => {
  try {
    const { storeUrl } = req.body;
    const userId = (req as any).user.id;

    const user = await prisma.user.update({
      where: { id: userId },
      data: { storeUrl },
    });

    const { password, ...safeUser } = user;

    return res.json(safeUser);
  } catch (err) {
    console.error("setStoreUrl Error", err);
    return res.status(500).json({ error: "UPDATE_FAILED" });
  }
};

// 온보딩 완료 플래그 설정
export const completeOnboarding = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const user = await prisma.user.update({
      where: { id: userId },
      data: { onboarded: true },
    });
    const { password, ...safeUser } = user;
    return res.json(safeUser);
  } catch (err) {
    console.error("completeOnboarding Error", err);
    return res.status(500).json({ error: "ONBOARDING_UPDATE_FAILED" });
  }
};

// 프로필/기본정보 수정
export const updateProfile = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const { name, nickname, gender, address } = req.body;
    const updated = await prisma.user.update({
      where: { id: userId },
      data: { name, nickname, gender, address },
    });
    const { password, ...safeUser } = updated;
    return res.json(safeUser);
  } catch (err) {
    console.error("updateProfile Error", err);
    return res.status(500).json({ error: "PROFILE_UPDATE_FAILED" });
  }
};
