import OpenAI from "openai";
import { prisma } from "../lib/prisma";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function generateSummary(reviewId: string, content: string) {
  const prompt = `
다음 리뷰 내용을 분석해 아래 형식으로 JSON만 출력하세요.

{
  "positives": [...],
  "negatives": [...],
  "insights": [...],
  "tags": [...]
}

규칙:
- tags는 리뷰의 핵심 키워드를 3~6개로 생성
- 해시태그 형태(#맛있음)로 만들지 말고 단어만(예: 맛있음, 친절, 대기시간)
- 다른 요소와 중복 없이 핵심만 포함

리뷰:
${content}
`;

  const response = await client.responses.create({
    model: "gpt-4.1-mini",
    input: prompt,
  });

  const text = response.output_text; // 모델이 생성한 JSON 문자열
  const json = JSON.parse(text);

  await prisma.summary.create({
    data: {
      reviewId,
      positives: json.positives ?? [],
      negatives: json.negatives ?? [],
      insights: json.insights ?? [],
    },
  });

  return json;
}
