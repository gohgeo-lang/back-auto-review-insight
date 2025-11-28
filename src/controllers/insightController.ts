import { Request, Response } from "express";
import { prisma } from "../lib/prisma";

export const getInsights = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const storeId = (req.query.storeId as string | undefined) || undefined;

    if (storeId) {
      const store = await prisma.store.findFirst({
        where: { id: storeId, userId },
        select: { id: true },
      });
      if (!store) return res.status(404).json({ error: "STORE_NOT_FOUND" });
    }

    const summaries = await prisma.summary.findMany({
      where: {
        review: {
          userId,
          ...(storeId ? { storeId } : {}),
        },
      },
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
    const keywordMap: Record<string, number> = {};
    const sentimentCounts = { positive: 0, negative: 0, irrelevant: 0 };
    for (const s of summaries) {
      const sentiment = (s as any).sentiment || "irrelevant";
      if (sentimentCounts[sentiment as "positive" | "negative" | "irrelevant"] !== undefined) {
        sentimentCounts[sentiment as "positive" | "negative" | "irrelevant"] += 1;
      }

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

      (s as any).keywords?.forEach((k: string) => {
        keywordMap[k] = (keywordMap[k] || 0) + 1;
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
      keywords: getTop3(keywordMap),
      sentimentCounts,
    });
  } catch (err) {
    console.error("getInsights Error:", err);
    return res.status(500).json({ error: "FAILED_TO_GET_INSIGHTS" });
  }
};
