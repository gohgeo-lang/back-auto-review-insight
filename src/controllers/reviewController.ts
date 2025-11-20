import { Request, Response } from "express";
import { prisma } from "../lib/prisma";

export const getReviews = async (req: Request, res: Response) => {
  const reviews = await prisma.review.findMany({
    include: { summary: true, reply: true },
  });
  res.json(reviews);
};

export const getReview = async (req: Request, res: Response) => {
  const review = await prisma.review.findUnique({
    where: { id: req.params.id },
    include: { summary: true, reply: true },
  });
  res.json(review);
};

export const createReview = async (req: Request, res: Response) => {
  const review = await prisma.review.create({ data: req.body });
  res.json(review);
};
