import { Request, Response } from "express";
import { prisma } from "../lib/prisma";

export const getInsights = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;

    const summaries = await prisma.summary.findMany({
      where: { review: { userId } },
      include: { review: true },
    });

    if (summaries.length === 0) {
      return res.json({
        positive: [],
        negative: [],
        insights: [],
        tags: [],
      });
    }

    const positiveMap: Record<string, number> = {};
    const negativeMap: Record<string, number> = {};
    const insightMap: Record<string, number> = {};
    const tagMap: Record<string, number> = {};
    for (const s of summaries) {
      s.positives.forEach((p) => {
        positiveMap[p] = (positiveMap[p] || 0) + 1;
      });

      s.negatives.forEach((n) => {
        negativeMap[n] = (negativeMap[n] || 0) + 1;
      });

      s.insights.forEach((i) => {
        insightMap[i] = (insightMap[i] || 0) + 1;
      });

      s.tags.forEach((t) => {
        tagMap[t] = (tagMap[t] || 0) + 1;
      });
    }

    const getTop3 = (map: Record<string, number>) =>
      Object.entries(map)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([k]) => k);

    return res.json({
      positive: getTop3(positiveMap),
      negative: getTop3(negativeMap),
      insights: getTop3(insightMap),
      tags: getTop3(tagMap),
    });
  } catch (err) {
    console.error("getInsights Error:", err);
    return res.status(500).json({ error: "FAILED_TO_GET_INSIGHTS" });
  }
};
