import { Request, Response } from "express";
import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const generateSummary = async (req: Request, res: Response) => {
  const { content } = req.body;
  const prompt = `
다음 리뷰 내용을 기반으로
1) 긍정 포인트 3개
2) 부정 포인트 3개
3) 반복되는 문제점 1개
4) 개선 추천 1개
한국어로 간결하게 요약해줘.

리뷰:
${content}
  `;

  const completion = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
  });

  res.json({ result: completion.choices[0].message.content });
};

export const generateReply = async (req: Request, res: Response) => {
  const { content, tone } = req.body;

  const prompt = `
다음 리뷰에 대해, 선택한 톤(${tone})으로 가게 사장님 입장에서 응답문을 작성해줘.
길이는 200자 내외.

리뷰:
${content}
`;

  const completion = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
  });

  res.json({ reply: completion.choices[0].message.content });
};
