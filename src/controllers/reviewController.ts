import { Request, Response } from "express";
import { prisma } from "../lib/prisma";

export const getReviews = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;

    const reviews = await prisma.review.findMany({
      where: { userId },
      include: { summary: true, reply: true },
      orderBy: { createdAt: "desc" },
    });
    return res.json(reviews);
  } catch (error) {
    console.error("getReviews Error", error);
    return res.status(500).json({ error: "FAILED_TO_GET_REVIEWS" });
  }
};

export const getReview = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const review = await prisma.review.findFirst({
      where: { id: req.params.id, userId },
      include: { summary: true, reply: true },
    });
    if (!review) return res.status(404).json({ error: "REVIEW_NOT_FOUND" });
    return res.json(review);
  } catch (error) {
    console.error("getReview Error", error);
    return res.status(500).json({ error: "FAILED_TO_GET_REVIEW" });
  }
};

export const createReview = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;

    const review = await prisma.review.create({
      data: {
        ...req.body,
        userId,
      },
    });

    return res.json(review);
  } catch (error) {
    console.error("createReview Error", error);
    return res.status(500).json({ error: "FAILED_TO_CREATE_REVIEW" });
  }
};
