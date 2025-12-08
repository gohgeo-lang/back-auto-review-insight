import { Request, Response } from "express";
import OpenAI from "openai";
import { prisma } from "../lib/prisma";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

type ParsedSummary = {
  sentiment?: string;
  sentimentDetail?: string;
  summary?: string;
  positives: string[];
  negatives: string[];
  insights: string[];
  tags: string[];
  keywords?: string[];
  batchSummary?: string;
  batchKeywords?: string[];
  batchPositives?: string[];
  batchNegatives?: string[];
  batchSentiment?: { pos: number; neu: number; neg: number };
};

class QuotaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuotaError";
  }
}

async function createFinalInsightReport(userId: string, storeId?: string) {
  const batches = await prisma.batchSummary.findMany({
    where: { userId, ...(storeId ? { storeId } : {}) },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  if (batches.length === 0) {
    throw new Error("NO_BATCH_SUMMARIES");
  }

  const summaries = await prisma.summary.findMany({
    where: { review: { userId, ...(storeId ? { storeId } : {}) } },
    select: {
      sentiment: true,
      keywords: true,
      tags: true,
      positives: true,
      negatives: true,
      summary: true,
    },
  });
  const summariesFiltered = summaries.filter((s) => {
    const hasContent =
      (s.summary && s.summary.trim() !== "") ||
      (s.keywords && s.keywords.length) ||
      (s.positives && s.positives.length) ||
      (s.negatives && s.negatives.length) ||
      (s.tags && s.tags.length);
    return hasContent;
  });

  const sentimentStats = { pos: 0, neu: 0, neg: 0 };
  const keywordFreq: Record<string, number> = {};
  const negCategoryStats: Record<string, number> = {};
  batches.forEach((b) => {
    sentimentStats.pos += b.batchSentimentPos || 0;
    sentimentStats.neu += b.batchSentimentNeu || 0;
    sentimentStats.neg += b.batchSentimentNeg || 0;
    (b.batchKeywords || []).forEach((k) => {
      keywordFreq[k] = (keywordFreq[k] || 0) + 1;
    });
    (b.batchNegatives || []).forEach((k) => {
      negCategoryStats[k] = (negCategoryStats[k] || 0) + 1;
    });
  });

  summaries.forEach((s) => {
    if (s.sentiment === "positive") sentimentStats.pos += 1;
    else if (s.sentiment === "neutral") sentimentStats.neu += 1;
    else if (s.sentiment === "negative") sentimentStats.neg += 1;
    (s.keywords || []).forEach((k) => {
      keywordFreq[k] = (keywordFreq[k] || 0) + 1;
    });
  });

  const batchSummaries = batches
    .map(
      (b) =>
        `- ${b.batchSummary || ""} (긍정:${b.batchSentimentPos}, 중립:${b.batchSentimentNeu}, 부정:${b.batchSentimentNeg})`
    )
    .join("\n");

  const prompt = `
You are an expert review insight analyst.

### 입력 데이터 ###
- 리뷰별 summary 데이터:
${JSON.stringify(summariesFiltered)}

- 배치 분석 결과:
${JSON.stringify(batches)}

- 전체 감성 통계:
${JSON.stringify(sentimentStats)}

- 키워드 전체 빈도:
${JSON.stringify(keywordFreq)}

- 부정 키워드 빈도:
${JSON.stringify(negCategoryStats)}

- 배치 요약 리스트:
${batchSummaries}

### 출력(JSON) ###
{
  "keywords": ["상위 5개"],
  "summary": "총평 300자 이하",
  "positives": [
    { "title": "핵심 강점", "reason": "근거 1문장" },
    { "title": "핵심 강점", "reason": "근거 1문장" },
    { "title": "핵심 강점", "reason": "근거 1문장" }
  ],
  "negatives": [
    { "title": "핵심 개선점", "reason": "근거 1문장" },
    { "title": "핵심 개선점", "reason": "근거 1문장" },
    { "title": "핵심 개선점", "reason": "근거 1문장" }
  ],
  "shopCharacter": "매장의 특징 분석",
  "solutions": ["실행 가능 솔루션 3개"],
  "strengths": {
    "keywords": ["상위 3개"],
    "comment": "강점 해설",
    "solutions": ["실행 가능한 솔루션 3개"]
  },
  "improvements": {
    "keywords": ["상위 3개"],
    "comment": "개선점 해설",
    "solutions": ["실행 가능한 솔루션 3개"]
  },
  "trends": {
    "keywords": ["상위 3개"],
    "comment": "최근 트렌드 분석",
    "solutions": ["실행 가능한 솔루션 3개"]
  }
}

### 규칙 ###
- 데이터 기반으로만 작성
- 없는 내용 생성 금지
- JSON 외 텍스트 금지
`.trim();

  const completion = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
  });
  const raw = completion.choices[0].message.content || "{}";
  console.log("[FinalInsight RAW]", raw);

  const safeParse = (text: string) => {
    try {
      return JSON.parse(text);
    } catch {
      const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
      const start = cleaned.indexOf("{");
      const end = cleaned.lastIndexOf("}");
      if (start !== -1 && end !== -1 && end > start) {
        const sliced = cleaned.slice(start, end + 1);
        return JSON.parse(sliced);
      }
      throw new Error("PARSE_FAIL");
    }
  };

  const parsed = safeParse(raw);

  const report = await prisma.report.create({
    data: {
      userId,
      storeId,
      period: "insight",
      rangeDays: 0,
      payload: parsed,
    },
  });

  return { parsed, reportId: report.id };
}

async function summarizeReviewText(reviewId: string, content: string) {
  const safeContent = (content || "").trim();
  if (!safeContent) {
    // 내용이 없으면 AI 호출 없이 무의미 데이터로 마킹
    return await prisma.summary.upsert({
      where: { reviewId },
      update: { sentiment: "irrelevant", keywords: [], tags: [], positives: [], negatives: [], insights: [] },
      create: {
        reviewId,
        sentiment: "irrelevant",
        keywords: [],
        tags: [],
        positives: [],
        negatives: [],
        insights: [],
      },
    });
  }

  const truncated =
    safeContent.length > 700 ? safeContent.slice(0, 700) + "..." : safeContent;

  const parseJsonSafe = (text: string): ParsedSummary => {
    const cleaned = text
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();
    try {
      return JSON.parse(cleaned);
    } catch {
      // 중괄호 범위를 다시 시도
      const start = cleaned.indexOf("{");
      const end = cleaned.lastIndexOf("}");
      if (start !== -1 && end !== -1 && end > start) {
        return JSON.parse(cleaned.slice(start, end + 1));
      }
      throw new Error("PARSE_FAIL");
    }
  };

  const prompt = `
다음 리뷰를 분석해 아래 JSON으로 답변하세요.
sentiment는 대분류로 "positive" | "neutral" | "negative" | "irrelevant" 중 하나를 선택합니다.
sentimentDetail은 소분류 12가지 중 하나를 선택합니다:
- positive: joy_contentment, excitement, admiration_awe, warmth_romance, calm
- neutral/info: boredom, confusion_awkward, neutral_info
- negative: disappointment_sadness, anxiety_fear, anger_frustration, disgust_contempt
- 기타/무관: irrelevant_noise
irrelevant는 매장과 무관하거나 의미 없는 내용일 때 사용합니다.
summary는 핵심 의미를 20자 이내로 작성합니다.
keywords는 명사 기반 3~6개, tags는 대표 태그 3개로 작성합니다.
{
  "sentiment": "positive",
  "sentimentDetail": "joy_contentment",
  "summary": "...",
  "positives": ["..."],
  "negatives": ["..."],
  "insights": ["..."],
  "tags": ["..."],
  "keywords": ["..."]
}

리뷰:
${truncated}
`;

  let raw = "{}";
  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
    });
    raw = completion.choices[0].message.content || "{}";
  } catch (err: any) {
    const code = err?.error?.code || err?.code;
    if (code === "insufficient_quota" || err?.status === 429) {
      throw new QuotaError("OPENAI_QUOTA_EXCEEDED");
    }
    throw err;
  }

  let parsed: ParsedSummary;
  try {
    parsed = parseJsonSafe(raw);
  } catch (error) {
    console.error("GPT JSON parse error:", raw);
    throw new Error("INVALID_AI_RESPONSE");
  }

  // 내용이 전무한 경우 저장하지 않음
  const hasContent =
    (parsed.summary && parsed.summary.trim() !== "") ||
    (parsed.keywords && parsed.keywords.length) ||
    (parsed.positives && parsed.positives.length) ||
    (parsed.negatives && parsed.negatives.length) ||
    (parsed.tags && parsed.tags.length);
  if (!hasContent) {
    throw new Error("EMPTY_AI_RESPONSE");
  }

  // 소분류 → 대분류 매핑
  const detail = (parsed.sentimentDetail || "").toLowerCase();
  const detailToMain = (d: string): "positive" | "negative" | "neutral" | "irrelevant" => {
    if (["joy_contentment", "excitement", "admiration_awe", "warmth_romance", "calm"].includes(d)) return "positive";
    if (["boredom", "confusion_awkward", "neutral_info"].includes(d)) return "neutral";
    if (["disappointment_sadness", "anxiety_fear", "anger_frustration", "disgust_contempt"].includes(d))
      return "negative";
    return "irrelevant";
  };
  const mainSentiment = parsed.sentiment || (detail ? detailToMain(detail) : "irrelevant");
  const tagsWithDetail = [
    ...(parsed.tags || []),
    ...(detail ? [`__sentDetail:${detail}`] : []),
  ];

  const summary = await prisma.summary.upsert({
    where: { reviewId },
    update: {
      sentiment: mainSentiment,
      summary: parsed.summary || "",
      positives: parsed.positives || [],
      negatives: parsed.negatives || [],
      insights: parsed.insights || [],
      tags: tagsWithDetail,
      keywords: parsed.keywords || [],
    },
    create: {
      reviewId,
      sentiment: mainSentiment,
      summary: parsed.summary || "",
      keywords: parsed.keywords || [],
      positives: parsed.positives || [],
      negatives: parsed.negatives || [],
      insights: parsed.insights || [],
      tags: tagsWithDetail,
    },
  });

  return summary;
}

export const generateSummary = async (req: Request, res: Response) => {
  try {
    const { reviewId, content } = req.body;
    const userId = (req as any).user?.id;

    if (!userId || !reviewId) {
      return res.status(400).json({ error: "MISSING_FIELDS" });
    }

    const review = await prisma.review.findFirst({
      where: { id: reviewId, userId },
    });

    if (!review) {
      return res.status(404).json({ error: "REVIEW_NOT_FOUND" });
    }
    const reviewContent = content || review.content;

    const summary = await summarizeReviewText(reviewId, reviewContent);

    return res.json(summary);
  } catch (error) {
    console.error("generateSummary Error:", error);
    if (error instanceof QuotaError) {
      return res.status(429).json({ error: "OPENAI_QUOTA_EXCEEDED" });
    }
    return res.status(500).json({ error: "SUMMARY_FAILED" });
  }
};

export const generateReply = async (req: Request, res: Response) => {
  try {
    const { reviewId, content, tone } = req.body;
    const userId = (req as any).user?.id;

    if (!userId) {
      return res.status(401).json({ error: "UNAUTHORIZED" });
    }

    if (!reviewId && !content) {
      return res.status(400).json({ error: "MISSING_FIELDS" });
    }

    let targetContent = content || "";
    if (reviewId) {
      const review = await prisma.review.findFirst({
        where: { id: reviewId, userId },
      });
      if (!review) {
        return res.status(404).json({ error: "REVIEW_NOT_FOUND" });
      }
      targetContent = content || review.content;
    }

    const prompt = `
다음 리뷰에 대해 '${tone}' 톤으로 가게 사장님 입장에서 응대문을 작성해줘.
길이는 200자 내외로.

리뷰:
${targetContent}
`;

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
    });

    const replyText = completion.choices[0].message.content || "";

    let savedReply = null;

    if (reviewId) {
      savedReply = await prisma.reply.upsert({
        where: { reviewId },
        update: { content: replyText, tone },
        create: { reviewId, content: replyText, tone },
      });
    }

    return res.json({
      reply: replyText,
      saved: savedReply,
    });
  } catch (error) {
    console.error("generatedReply Error:", error);
    return res.status(500).json({ error: "REPLY_FAILED" });
  }
};

// -----------------------
// 배치 요약 (5~10개 리뷰를 한 번에 분석해 BatchSummary 저장)
// -----------------------
export const generateBatchSummaries = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const storeId = (req.body?.storeId as string | undefined) || undefined;
    if (!userId) return res.status(401).json({ error: "UNAUTHORIZED" });
    if (!process.env.OPENAI_API_KEY) {
      return res.status(400).json({ error: "MISSING_OPENAI_API_KEY" });
    }

    const BATCH_SIZE = 10;
    const MAX_BATCHES = 30; // 한 요청당 최대 300건
    const processed: any[] = [];
    for (let i = 0; i < MAX_BATCHES; i++) {
      const pending = await prisma.review.findMany({
        where: { userId, ...(storeId ? { storeId } : {}), summary: null },
        orderBy: { createdAt: "desc" },
        take: BATCH_SIZE,
        select: { id: true, content: true },
      });
      if (pending.length === 0) break;

      const reviewsText = pending
        .map((r, idx) => `${idx + 1}. ${(r.content || "").trim().replace(/\s+/g, " ").slice(0, 700)}`)
        .join("\n");

      const prompt = `
당신은 리뷰 인사이트 분석가입니다.
아래 리뷰 5~10개를 분석해 JSON만 출력하세요.

### 출력(JSON) ###
{
  "batchSummary": "200자 이하 핵심 요약",
  "keywords": ["중요 키워드 8~15개"],
  "positives": ["반복되는 긍정 포인트 3개"],
  "negatives": ["반복되는 부정 포인트 3개"],
  "sentimentCount": { "pos": n, "neu": n, "neg": n }
}

리뷰 목록:
${reviewsText}
    `.trim();

      const completion = await client.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
      });

      const raw = completion.choices[0].message.content || "{}";
      const parseSafe = (text: string) => {
        try {
          return JSON.parse(text);
        } catch {
          const cleaned = text
            .replace(/```json/gi, "")
            .replace(/```/g, "")
            .trim();
          const start = cleaned.indexOf("{");
          const end = cleaned.lastIndexOf("}");
          if (start !== -1 && end !== -1 && end > start) {
            return JSON.parse(cleaned.slice(start, end + 1));
          }
          throw new Error("PARSE_FAIL");
        }
      };

      let parsed: any = {
        batchSummary: "",
        keywords: [],
        positives: [],
        negatives: [],
        sentimentCount: { pos: 0, neu: 0, neg: 0 },
      };
      try {
        parsed = parseSafe(raw);
      } catch (e) {
        console.error("Batch summary JSON parse error:", raw);
        // 파싱 실패 시에도 진행을 계속하고, 최소 구조로 채워 중단되지 않도록 함
      }

      const created = await prisma.batchSummary.create({
        data: {
          userId,
          storeId,
          reviewIds: pending.map((p) => p.id),
          batchSummary: parsed.batchSummary || null,
          batchKeywords: parsed.keywords || [],
          batchPositives: parsed.positives || [],
          batchNegatives: parsed.negatives || [],
          batchSentimentPos: parsed.sentimentCount?.pos || 0,
          batchSentimentNeu: parsed.sentimentCount?.neu || 0,
          batchSentimentNeg: parsed.sentimentCount?.neg || 0,
        },
      });
      processed.push({
        batchSummaryId: created.id,
        count: pending.length,
        data: parsed,
      });

      // 표시된 리뷰들이 다시 선택되지 않도록 최소 Summary 레코드 생성
      await prisma.summary.createMany({
        data: pending.map((p) => ({
          reviewId: p.id,
          sentiment: "irrelevant",
          positives: [],
          negatives: [],
          insights: [],
          tags: [],
          keywords: [],
        })),
        skipDuplicates: true,
      });

      if (pending.length < BATCH_SIZE) break;
    }

    return res.json({
      ok: true,
      processed: processed.reduce((s, b) => s + b.count, 0),
      batches: processed,
    });
  } catch (error) {
    console.error("generateBatchSummaries Error:", error);
    if (error instanceof QuotaError) {
      return res.status(429).json({ error: "OPENAI_QUOTA_EXCEEDED" });
    }
    return res.status(500).json({ error: "BATCH_SUMMARY_FAILED" });
  }
};

// -----------------------
// 배치 기반 최종 인사이트 리포트 생성
// -----------------------
export const generateFinalInsight = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const storeId = (req.body?.storeId as string | undefined) || undefined;
    if (!userId) return res.status(401).json({ error: "UNAUTHORIZED" });
    if (!process.env.OPENAI_API_KEY) {
      return res.status(400).json({ error: "MISSING_OPENAI_API_KEY" });
    }

    const { parsed, reportId } = await createFinalInsightReport(userId, storeId);
    return res.json({ ok: true, data: parsed, reportId });
  } catch (error) {
    console.error("generateFinalInsight Error:", error);
    if (error instanceof QuotaError) {
      return res.status(429).json({ error: "OPENAI_QUOTA_EXCEEDED" });
    }
    return res.status(500).json({ error: "FINAL_INSIGHT_FAILED" });
  }
};

// 미분석 리뷰 일괄 요약 (5개 소배치 병렬)
export const generateMissingSummaries = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const storeId = (req.body?.storeId as string | undefined) || undefined;
    if (!userId) return res.status(401).json({ error: "UNAUTHORIZED" });
    if (!process.env.OPENAI_API_KEY) {
      return res.status(400).json({ error: "MISSING_OPENAI_API_KEY" });
    }

    if (storeId) {
      const store = await prisma.store.findFirst({
        where: { id: storeId, userId },
        select: { id: true },
      });
      if (!store) return res.status(404).json({ error: "STORE_NOT_FOUND" });
    }

    // 기존 Summary가 없는 리뷰만 조회
    const pendingRaw = await prisma.review.findMany({
      where: {
        userId,
        summary: null,
        ...(storeId ? { storeId } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 50, // 한 번 호출에 최대 50건만 처리
    });

    // 내용이 비어있는 리뷰는 AI 호출 없이 irrevelant로 마킹 후 스킵
    const emptyContents = pendingRaw.filter((p) => !p.content?.trim());
    if (emptyContents.length) {
      await prisma.summary.createMany({
        data: emptyContents.map((p) => ({
          reviewId: p.id,
          sentiment: "irrelevant",
          positives: [],
          negatives: [],
          insights: [],
          tags: [],
          keywords: [],
        })),
        skipDuplicates: true,
      });
    }
    const pending = pendingRaw.filter((p) => p.content?.trim());

    if (pending.length === 0) {
      return res.json({ ok: true, processed: 0, message: "NO_PENDING_REVIEWS" });
    }

    const batchSize = 5;
    let processed = 0;
    const failed: string[] = [];

    // 5개씩 병렬 처리(소배치 단위)로 속도 향상
    for (let i = 0; i < pending.length; i += batchSize) {
      const chunk = pending.slice(i, i + batchSize);
      const results = await Promise.allSettled(
        chunk.map((r) => summarizeReviewText(r.id, r.content))
      );

      for (let idx = 0; idx < results.length; idx++) {
        const r = results[idx];
        const target = chunk[idx];
        if (r.status === "fulfilled") {
          processed += 1;
        } else {
          console.error("Batch summary failed for", target.id, r.reason);
          if (r.reason instanceof QuotaError) {
            return res.status(429).json({
              error: "OPENAI_QUOTA_EXCEEDED",
              processed,
              failed,
            });
          }
          failed.push(target.id);
        }
      }
    }

    return res.json({ ok: true, processed, failed });
  } catch (error) {
    console.error("generateMissingSummaries Error:", error);
    if (error instanceof QuotaError) {
      return res.status(429).json({ error: "OPENAI_QUOTA_EXCEEDED" });
    }
    return res.status(500).json({ error: "SUMMARY_BATCH_FAILED" });
  }
};
