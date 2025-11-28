import { Request, Response } from "express";
import { prisma } from "../lib/prisma";

type Period = "weekly" | "monthly" | "quarterly" | "yearly" | "custom";

function getCutoff(rangeDays: number) {
  const d = new Date();
  d.setDate(d.getDate() - rangeDays);
  return d;
}

export const generateReport = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const storeId = (req.body?.storeId as string | undefined) || undefined;
    const period = (req.body?.period as Period | undefined) || "monthly";
    const rangeDays = Number(req.body?.rangeDays || 30);

    if (!userId) return res.status(401).json({ error: "UNAUTHORIZED" });
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: "USER_NOT_FOUND" });
    if (storeId) {
      const own = await prisma.store.findFirst({ where: { id: storeId, userId } });
      if (!own) return res.status(404).json({ error: "STORE_NOT_FOUND" });
    }

    // 무료 사용자는 첫 리포트 1회만 무료, 그 이후에는 구독 또는 크레딧 필요
    if (user.subscriptionStatus !== "active") {
      const reportCount = await prisma.report.count({
        where: { userId, ...(storeId ? { storeId } : {}) },
      });
      if (reportCount > 0) {
        if ((user.extraCredits || 0) <= 0) {
          return res.status(402).json({
            error: "REPORT_PAYMENT_REQUIRED",
            message: "무료 리포트 1회를 사용했습니다. 추가 리포트는 결제 후 이용하세요.",
          });
        }
        await prisma.user.update({
          where: { id: userId },
          data: { extraCredits: Math.max(0, (user.extraCredits || 0) - 1) },
        });
      }
    }

    const cutoff = getCutoff(rangeDays);
    const summaries = await prisma.summary.findMany({
      where: {
        review: {
          userId,
          ...(storeId ? { storeId } : {}),
          createdAt: { gte: cutoff },
        },
      },
      include: { review: true },
    });

    const sentimentCounts = { positive: 0, negative: 0, neutral: 0, irrelevant: 0 };
    const tagMap: Record<string, number> = {};
    const keywordMap: Record<string, number> = {};

    summaries.forEach((s) => {
      const sentiment = (s as any).sentiment || "irrelevant";
      if (sentimentCounts[sentiment as keyof typeof sentimentCounts] !== undefined) {
        sentimentCounts[sentiment as keyof typeof sentimentCounts] += 1;
      }
      s.tags.forEach((t) => (tagMap[t] = (tagMap[t] || 0) + 1));
      (s as any).keywords?.forEach((k: string) => (keywordMap[k] = (keywordMap[k] || 0) + 1));
    });

    const topN = (map: Record<string, number>, n = 10) =>
      Object.entries(map)
        .sort((a, b) => b[1] - a[1])
        .slice(0, n)
        .map(([k, v]) => ({ label: k, count: v }));

    const payload = {
      sentimentCounts,
      tags: topN(tagMap, 10),
      keywords: topN(keywordMap, 10),
      totalReviews: summaries.length,
      rangeDays,
      generatedAt: new Date().toISOString(),
    };

    const report = await prisma.report.create({
      data: {
        userId,
        storeId,
        period,
        rangeDays,
        payload,
      },
    });

    return res.json({ ok: true, report });
  } catch (err) {
    console.error("generateReport error:", err);
    return res.status(500).json({ error: "REPORT_GENERATE_FAILED" });
  }
};

export const getReports = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const storeId = (req.query.storeId as string | undefined) || undefined;
    const id = (req.query.id as string | undefined) || undefined;
    if (!userId) return res.status(401).json({ error: "UNAUTHORIZED" });
    if (id) {
      const report = await prisma.report.findFirst({
        where: { id, userId, ...(storeId ? { storeId } : {}) },
      });
      if (!report) return res.status(404).json({ error: "REPORT_NOT_FOUND" });
      return res.json(report);
    }
    if (storeId) {
      const own = await prisma.store.findFirst({ where: { id: storeId, userId } });
      if (!own) return res.status(404).json({ error: "STORE_NOT_FOUND" });
    }

    const reports = await prisma.report.findMany({
      where: { userId, ...(storeId ? { storeId } : {}) },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    return res.json(reports);
  } catch (err) {
    console.error("getReports error:", err);
    return res.status(500).json({ error: "REPORT_FETCH_FAILED" });
  }
};
