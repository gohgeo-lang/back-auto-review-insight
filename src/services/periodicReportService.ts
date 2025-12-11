import { prisma } from "../lib/prisma";

type Period = "weekly" | "monthly" | "quarterly" | "yearly";

const periodRange: Record<Period, number> = {
  weekly: 7,
  monthly: 30,
  quarterly: 90,
  yearly: 365,
};

type SentimentCounts = { positive: number; negative: number; neutral: number; irrelevant: number };

function initCounts(): SentimentCounts {
  return { positive: 0, negative: 0, neutral: 0, irrelevant: 0 };
}

function topN(map: Record<string, number>, n: number) {
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([label, count]) => ({ label, count }));
}

async function getSummaryStats(userId: string, storeId: string | null, since: Date, until: Date) {
  const summaries = await prisma.summary.findMany({
    where: {
      review: {
        userId,
        ...(storeId ? { storeId } : {}),
        createdAt: { gte: since, lte: until },
      },
    },
  });

  const counts = initCounts();
  const keywordMap: Record<string, number> = {};
  const negativeMap: Record<string, number> = {};

  summaries.forEach((s) => {
    const sent = (s as any).sentiment || "irrelevant";
    if (counts[sent as keyof SentimentCounts] !== undefined) {
      counts[sent as keyof SentimentCounts] += 1;
    } else {
      counts.irrelevant += 1;
    }
    (s as any).keywords?.forEach((k: string) => {
      if (!k) return;
      keywordMap[k] = (keywordMap[k] || 0) + 1;
    });
    (s as any).negatives?.forEach((k: string) => {
      if (!k) return;
      negativeMap[k] = (negativeMap[k] || 0) + 1;
    });
  });

  return {
    summariesCount: summaries.length,
    sentimentCounts: counts,
    keywordsTop: topN(keywordMap, 10),
    negativesTop: topN(negativeMap, 5),
  };
}

export async function generatePeriodicReportPayload(
  period: Period,
  userId: string,
  storeId: string | null
) {
  const rangeDays = periodRange[period];
  const now = new Date();
  const from = new Date(now.getTime() - rangeDays * 24 * 3600 * 1000);
  const prevFrom = new Date(from.getTime() - rangeDays * 24 * 3600 * 1000);

  const current = await getSummaryStats(userId, storeId, from, now);
  const previous = await getSummaryStats(userId, storeId, prevFrom, from);

  const reviewDelta = current.summariesCount - previous.summariesCount;
  const sentimentDelta = {
    positive: current.sentimentCounts.positive - previous.sentimentCounts.positive,
    negative: current.sentimentCounts.negative - previous.sentimentCounts.negative,
    neutral: current.sentimentCounts.neutral - previous.sentimentCounts.neutral,
  };

  // 급증/급감 키워드: delta 상위 3개
  const keywordDeltaMap: Record<string, number> = {};
  current.keywordsTop.forEach(({ label, count }) => {
    const prev = previous.keywordsTop.find((p) => p.label === label)?.count || 0;
    keywordDeltaMap[label] = count - prev;
  });
  const spikes = topN(keywordDeltaMap, 3).filter((k) => k.count !== 0);

  if (period === "weekly") {
    const urgentNegatives = current.negativesTop.slice(0, 3).map((n) => n.label);
    return {
      type: "weekly",
      rangeDays,
      generatedAt: now.toISOString(),
      weeklyStats: {
        reviewCount: current.summariesCount,
        reviewDelta,
        sentimentDelta,
        topKeywords: current.keywordsTop.slice(0, 3).map((k) => k.label),
        spikes: spikes.map((s) => s.label),
        urgentNegatives,
      },
    };
  }

  if (period === "monthly") {
    return {
      type: "monthly",
      rangeDays,
      generatedAt: now.toISOString(),
      volume: { total: current.summariesCount, deltaPrevMonth: reviewDelta },
      sentiment: {
        ...current.sentimentCounts,
        deltaPrevMonth: sentimentDelta,
      },
      topKeywords: current.keywordsTop.slice(0, 5),
      keywordTrends: spikes,
      liked: current.keywordsTop.slice(0, 3).map((k) => k.label),
      disliked: current.negativesTop.map((k) => k.label),
      featuredReviews: [], // 추후 대표 리뷰 요약 연동 가능
    };
  }

  if (period === "quarterly") {
    return {
      type: "quarterly",
      rangeDays,
      generatedAt: now.toISOString(),
      volume: { total: current.summariesCount, deltaPrevQuarter: reviewDelta },
      sentimentTrend: [current.sentimentCounts],
      keywordTrends: spikes,
      persistentNegatives: current.negativesTop.map((n) => n.label),
      brandAssets: current.keywordsTop.slice(0, 3).map((k) => k.label),
      strategicInsights: [],
      strategicActions: [],
    };
  }

  // yearly
  return {
    type: "yearly",
    rangeDays,
    generatedAt: now.toISOString(),
    volume: { total: current.summariesCount, deltaPrevYear: reviewDelta },
    sentimentYearTrend: [current.sentimentCounts],
    strongKeywords: current.keywordsTop.slice(0, 5).map((k) => k.label),
    weakKeywords: current.negativesTop.map((k) => k.label),
    improved: [],
    worsened: [],
    seasonal: [],
    persona: [],
    featuredReviews: [],
    nextYearPlan: [],
  };
}
