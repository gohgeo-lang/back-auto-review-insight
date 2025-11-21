import { Request, Response } from "express";
import OpenAI from "openai";
import { prisma } from "../lib/prisma";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const generateSummary = async (req: Request, res: Response) => {
  try {
    const { reviewId, content } = req.body;

    if (!reviewId || !content) {
      return res.status(400).json({ error: "MISSING_FIELDS" });
    }

    const prompt = `
다음 리뷰 내용을 기반으로 긍정/부정/인사이트/tags를 JSON 형식으로 정리해줘.

아래 JSON 형식을 엄격히 따라.
{
  "positives": ["..."],
  "negatives": ["..."],
  "insights": ["..."],
  "tags": ["..."]
}

리뷰:
${content}
`;

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
    });

    const raw = completion.choices[0].message.content || "{}";

    let parsed: {
      positives: string[];
      negatives: string[];
      insights: string[];
      tags: string[];
    };
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      console.error("GPT JSON parse error:", raw);
      return res.status(500).json({ error: "INVALID_AI_RESPONSE" });
    }

    const summary = await prisma.summary.upsert({
      where: { reviewId },
      update: parsed,
      create: {
        reviewId,
        ...parsed,
      },
    });

    return res.json(summary);
  } catch (error) {
    console.error("generateSummary Error:", error);
    return res.status(500).json({ error: "SUMMARY_FAILED" });
  }
};

export const generateReply = async (req: Request, res: Response) => {
  try {
    const { reviewId, content, tone } = req.body;
    if (!content) {
      return res.status(400).json({ error: "MISSING_FIELDS" });
    }

    const prompt = `
다음 리뷰에 대해 '${tone}' 톤으로 가게 사장님 입장에서 응대문을 작성해줘.
길이는 200자 내외로.

리뷰:
${content}
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
