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
    const recentSummaries: string[] = [];
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
      // 최근 리뷰 요약용: 최신순으로 Summary 텍스트(insights) 하나씩 수집
      if (s.insights.length) {
        recentSummaries.push(s.insights[0]);
      }
    }

    const getTopN = (map: Record<string, number>, n: number) =>
      Object.entries(map)
        .sort((a, b) => b[1] - a[1])
        .slice(0, n)
        .map(([k]) => k);

    const topPos = getTopN(positiveMap, 5);
    const topNeg = getTopN(negativeMap, 5);
    const topTrends = getTopN(insightMap, 5);
    const topKeywords = getTopN(keywordMap, 5);
    const topKeywords50 = getTopN(keywordMap, 50);

    // 최종 인사이트 리포트가 있으면, 부족한 필드만 보완한 뒤 반환
    const latestReport = await prisma.report.findFirst({
      where: { userId, period: "insight", ...(storeId ? { storeId } : {}) },
      orderBy: { createdAt: "desc" },
    });
    if (latestReport?.payload) {
      const p: any = latestReport.payload || {};
      return res.json({
        ...p,
        keywords: p.keywords || topKeywords.slice(0, 3),
        keywordsTop50: p.keywordsTop50 || topKeywords50.map((k) => ({ keyword: k, count: keywordMap[k] })),
        positives: p.positives?.map((x: any) => x.title || x) || topPos,
        negatives: p.negatives?.map((x: any) => x.title || x) || topNeg,
        trends: p.trends || topTrends,
        autoCategories: p.autoCategories || buildCategories(keywordMap),
        keywordSolutions: p.keywordSolutions || topKeywords.slice(0, 5).map((k) => `${k} 관련 안내/프로모션을 강화하세요.`),
        recentSummaries: p.recentSummaries || [],
        description: p.shopCharacter || p.description || "",
        insightsSummary: p.summary || "",
        solutions: p.solutions || [],
      });
    }

    // 간단한 해설 템플릿 생성
    const summaryParts: string[] = [];
    const quoteList = (arr: string[]) => arr.map((t) => `"${t}"`).join(", ");

    if (topPos.length) {
      summaryParts.push(
        `고객들은 ${quoteList(topPos)}를 강점으로 자주 언급합니다.`
      );
    }
    if (topNeg.length) {
      summaryParts.push(
        `${quoteList(topNeg)} 관련 불만이 반복되니 우선 개선을 고려하세요.`
      );
    }
    if (topTrends.length) {
      summaryParts.push(`최근 트렌드: ${quoteList(topTrends)}.`);
    } else if (topKeywords.length) {
      summaryParts.push(`주요 키워드: ${quoteList(topKeywords)}.`);
    }
    const insightsSummary = summaryParts.join(" ");

    // 구조화된 긍/부정 리스트 (title/reason) 생성
    const toLabeledList = (entries: [string, number][]) =>
      entries.slice(0, 3).map(([k, v]) => ({
        title: k,
        reason: `${v}회 언급`,
      }));
    const positiveEntries = Object.entries(positiveMap).sort((a, b) => b[1] - a[1]);
    const negativeEntries = Object.entries(negativeMap).sort((a, b) => b[1] - a[1]);
    const positivesStruct = toLabeledList(positiveEntries);
    const negativesStruct = toLabeledList(negativeEntries);

    const shopCharacter =
      topPos.length > 0
        ? `고객들이 ${quoteList(topPos.slice(0, 3))}을(를) 매장의 특징으로 인식합니다.`
        : "";
    const solutions =
      topNeg.length > 0
        ? topNeg.slice(0, 3).map((n) => `${n} 관련 개선을 우선 검토하세요.`)
        : [];

    return res.json({
      // 구버전 키
      positive: topPos.slice(0, 3),
      negative: topNeg.slice(0, 3),
      insights: topTrends.slice(0, 3),
      tags: getTopN(tagMap, 3),
      keywords: topKeywords.slice(0, 3),
      // 신버전 키 (프론트가 기대하는 이름)
      positives: topPos,
      negatives: topNeg,
      trends: topTrends,
      recentSummaries: recentSummaries.slice(0, 5),
      description: summaries.length
        ? "최근 리뷰를 기반으로 자동 생성된 요약입니다."
        : "",
      insightsSummary,
      // 추가 필드 (프롬프트 구조 호환)
      structured: {
        keywords: topKeywords,
        summary: insightsSummary,
        positives: positivesStruct,
        negatives: negativesStruct,
        shopCharacter,
        solutions,
      },
      sentimentCounts,
      core: {
        comments: summaryParts.slice(0, 5),
        summary: insightsSummary,
      },
      strengths: {
        keywords: topPos,
        comment: topPos.length
          ? `강점 키워드 ${quoteList(topPos.slice(0, 3))}가 반복 언급됩니다.`
          : "",
        solutions: topPos.slice(0, 3).map((k) => `${k} 강점을 강조하는 안내/비주얼을 유지하세요.`),
      },
      improvements: {
        keywords: topNeg,
        comment: topNeg.length
          ? `${quoteList(topNeg.slice(0, 3))} 관련 불만이 반복됩니다.`
          : "",
        solutions: topNeg
          .slice(0, 3)
          .map((k) => `${k} 불만을 줄이기 위한 보완책(안내/프로세스/품질)을 마련하세요.`),
      },
      trendsDetail: {
        keywords: topTrends,
        comment: topTrends.length ? `최근 트렌드: ${quoteList(topTrends.slice(0, 3))}` : "",
        solutions: topTrends
          .slice(0, 3)
          .map((k) => `${k} 관련 트렌드를 유지/확장할 액션을 검토하세요.`),
      },
      keywordsTop50: topKeywords50.map((k) => ({ keyword: k, count: keywordMap[k] })),
      autoCategories: buildCategories(keywordMap),
      keywordSolutions: topKeywords.slice(0, 5).map((k) => `${k} 관련 안내/프로모션을 강화하세요.`),
      sentimentDetail: {
        positives: Object.entries(positiveMap)
          .sort((a, b) => b[1] - a[1])
          .map(([k]) => k),
        negatives: Object.entries(negativeMap)
          .sort((a, b) => b[1] - a[1])
          .map(([k]) => k),
        neutral: [],
        irrelevant: [],
        counts: {
          positive: sentimentCounts.positive,
          negative: sentimentCounts.negative,
          neutral: 0,
          irrelevant: sentimentCounts.irrelevant,
        },
      },
    });
  } catch (err) {
    console.error("getInsights Error:", err);
    return res.status(500).json({ error: "FAILED_TO_GET_INSIGHTS" });
  }
};

function buildCategories(keywordMap: Record<string, number>) {
  const buckets: Record<string, string[]> = {};
  const push = (cat: string, k: string) => {
    if (!buckets[cat]) buckets[cat] = [];
    if (buckets[cat].length < 10) buckets[cat].push(k);
  };
  Object.entries(keywordMap)
    .sort((a, b) => b[1] - a[1])
    .forEach(([k]) => {
      const kw = k.toLowerCase();
      if (kw.includes("가격") || kw.includes("비싸") || kw.includes("가성비")) push("가격", k);
      else if (kw.includes("친절") || kw.includes("응대") || kw.includes("서비스")) push("서비스", k);
      else if (kw.includes("대기") || kw.includes("줄") || kw.includes("시간")) push("대기/속도", k);
      else if (kw.includes("맛") || kw.includes("커피") || kw.includes("음식") || kw.includes("메뉴"))
        push("메뉴/맛", k);
      else if (kw.includes("청결") || kw.includes("위생")) push("청결", k);
      else push("기타", k);
    });
  return Object.entries(buckets).map(([category, keywords]) => ({ category, keywords }));
}
