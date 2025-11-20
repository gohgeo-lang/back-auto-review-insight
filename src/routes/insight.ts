import { Router } from "express";
import { prisma } from "../lib/prisma";

const router = Router();

router.get("/:userId", async (req, res) => {
  const { userId } = req.params;

  const summaries = await prisma.summary.findMany({
    where: {
      review: { userId },
    },
    include: { review: true },
  });

  // 긍정/부정 빈도
  const positiveMap: Record<string, number> = {};
  const negativeMap: Record<string, number> = {};

  for (const s of summaries) {
    s.positives.forEach((p: string) => {
      positiveMap[p] = (positiveMap[p] || 0) + 1;
    });
    s.negatives.forEach((n: string) => {
      negativeMap[n] = (negativeMap[n] || 0) + 1;
    });
  }

  const topPositive = Object.entries(positiveMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k]) => k);

  const topNegative = Object.entries(negativeMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k]) => k);

  res.json({
    positive: topPositive,
    negative: topNegative,
  });
});

export default router;
