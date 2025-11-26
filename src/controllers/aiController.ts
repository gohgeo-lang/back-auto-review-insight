import { Request, Response } from "express";
import OpenAI from "openai";
import { prisma } from "../lib/prisma";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

type ParsedSummary = {
  sentiment?: string;
  positives: string[];
  negatives: string[];
  insights: string[];
  tags: string[];
  keywords?: string[];
};

class QuotaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuotaError";
  }
}

async function summarizeReviewText(reviewId: string, content: string) {
  const truncated =
    content.length > 700 ? content.slice(0, 700) + "..." : content;

  const prompt = `
다음 리뷰를 분석해 아래 JSON으로 답변하세요.
sentiment는 "positive" | "negative" | "irrelevant" 중 하나로 선택합니다.
irrelevant는 매장과 무관하거나 의미 없는 내용일 때 사용합니다.
tags/keywords는 핵심 키워드(메뉴명 포함)를 간결히 추출합니다.
{
  "sentiment": "positive",
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
    parsed = JSON.parse(raw);
  } catch (error) {
    console.error("GPT JSON parse error:", raw);
    throw new Error("INVALID_AI_RESPONSE");
  }

  const summary = await prisma.summary.upsert({
    where: { reviewId },
    update: parsed,
    create: {
      reviewId,
      sentiment: parsed.sentiment || "irrelevant",
      keywords: parsed.keywords || [],
      ...parsed,
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

// 미분석 리뷰 일괄 요약 (최대 10개씩)
export const generateMissingSummaries = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: "UNAUTHORIZED" });
    if (!process.env.OPENAI_API_KEY) {
      return res.status(400).json({ error: "MISSING_OPENAI_API_KEY" });
    }

    const pending = await prisma.review.findMany({
      where: { userId, summary: null },
      orderBy: { createdAt: "desc" },
      take: 5,
    });

    if (pending.length === 0) {
      return res.json({ ok: true, processed: 0, message: "NO_PENDING_REVIEWS" });
    }

    let processed = 0;
    const failed: string[] = [];
    for (const r of pending) {
      try {
        await summarizeReviewText(r.id, r.content);
        processed += 1;
      } catch (err) {
        console.error("Batch summary failed for", r.id, err);
        if (err instanceof QuotaError) {
          return res.status(429).json({
            error: "OPENAI_QUOTA_EXCEEDED",
            processed,
            failed,
          });
        }
        failed.push(r.id);
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
