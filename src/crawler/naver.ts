import axios from "axios";
import * as cheerio from "cheerio";
import { prisma } from "../lib/prisma";
import { generateSummary } from "../ai/generateSummary";

export async function fetchNaverReviews(placeId: string, userId: string) {
  try {
    const url = `https://pcmap.place.naver.com/place/${placeId}/review/visitor?entry=pll`;

    const html = await axios.get(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
      },
    });

    const $ = cheerio.load(html.data);
    const reviews: any[] = [];

    $(".EvB_Z .zPfVt").each((_, el) => {
      const content = $(el).text().trim();
      if (content.length === 0) return;

      const ratingEl = $(el)
        .closest(".EvB_Z")
        .find(".hzzSN span[class*='PlaceReviewScore']")
        .text()
        .trim();

      const rating = Number(ratingEl) || 0;
      const date = $(el).closest(".EvB_Z").find(".time").text().trim();

      reviews.push({
        platform: "Naver",
        rating,
        content,
        date,
      });
    });

    let added = 0;

    // DB 저장 파트
    for (const r of reviews) {
      const exists = await prisma.review.findFirst({
        where: {
          userId,
          content: r.content, // 중복 방지 기준
        },
      });

      // 이미 있으면 skip
      if (exists) continue;

      // 신규 리뷰 저장
      const newReview = await prisma.review.create({
        data: {
          userId,
          platform: r.platform,
          rating: r.rating,
          content: r.content,
        },
      });

      // 저장 직후 summary 자동 생성
      try {
        await generateSummary(newReview.id, newReview.content);
      } catch (e) {
        console.error("요약 생성 실패:", e);
      }

      added++;
    }

    return added;
  } catch (err) {
    console.error("Naver fetch error:", err);
    return 0;
  }
}
