import { prisma } from "../lib/prisma";

export async function generateReportPayload(userId: string, storeId: string | null, rangeDays: number) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - rangeDays);

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

  return {
    sentimentCounts,
    tags: topN(tagMap, 10),
    keywords: topN(keywordMap, 10),
    totalReviews: summaries.length,
    rangeDays,
    generatedAt: new Date().toISOString(),
  };
}
