import { Request, Response } from "express";
import { prisma } from "../lib/prisma";

export const getSummary = async (req: Request, res: Response) => {
  try {
    const { reviewId } = req.params;
    const userId = (req as any).user.id;

    const summary = await prisma.summary.findFirst({
      where: {
        reviewId,
        review: { userId },
      },
    });

    if (!summary) {
      return res.status(404).json({ error: "SUMMARY_NOT_FOUND" });
    }
    return res.json(summary);
  } catch (error) {
    console.error("getSummary Error;", error);
    return res.status(500).json({ error: "FAILED_TO_GET_SUMAMRY" });
  }
};
