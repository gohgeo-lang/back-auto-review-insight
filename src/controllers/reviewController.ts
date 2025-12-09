import { Request, Response } from "express";
import { prisma } from "../lib/prisma";

export const getReviews = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const storeId = (req.query.storeId as string | undefined) || undefined;
    const collectedToday = req.query.collectedToday === "true";
    const collectedFrom = (req.query.collectedFrom as string | undefined) || undefined;
    const collectedTo = (req.query.collectedTo as string | undefined) || undefined;

    const collectedFilter: any = {};
    if (collectedToday) {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date();
      end.setHours(23, 59, 59, 999);
      collectedFilter.collectedAt = { gte: start, lte: end };
    } else if (collectedFrom || collectedTo) {
      const gte = collectedFrom ? new Date(collectedFrom) : undefined;
      const lte = collectedTo ? new Date(collectedTo) : undefined;
      if ((gte && !isNaN(gte.getTime())) || (lte && !isNaN(lte.getTime()))) {
        collectedFilter.collectedAt = {
          ...(gte && !isNaN(gte.getTime()) ? { gte } : {}),
          ...(lte && !isNaN(lte.getTime()) ? { lte } : {}),
        };
      }
    }

    if (storeId) {
      const store = await prisma.store.findFirst({
        where: { id: storeId, userId },
        select: { id: true },
      });
      if (!store) return res.status(404).json({ error: "STORE_NOT_FOUND" });
    }

    const reviews = await prisma.review.findMany({
      where: { userId, ...(storeId ? { storeId } : {}), ...collectedFilter },
      select: {
        id: true,
        userId: true,
        storeId: true,
        reviewId: true,
        platform: true,
        rating: true,
        // 원문 content는 프런트로 전송하지 않음
        summary: true,
        reply: true,
        createdAt: true,
        collectedAt: true,
      },
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
    const reviewId = req.params.id;
    const review = await prisma.review.findFirst({
      where: {
        userId,
        OR: [{ id: reviewId }, { reviewId }],
      },
      select: {
        id: true,
        userId: true,
        reviewId: true,
        platform: true,
        rating: true,
        summary: true,
        reply: true,
        createdAt: true,
      },
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
