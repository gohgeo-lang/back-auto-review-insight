import axios from "axios";
import * as cheerio from "cheerio";
import { prisma } from "../lib/prisma";
import { generateSummary } from "../controllers/aiController"; // 변경됨!

/**
 * 네이버 리뷰 수집 (PC 기준)
 */
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

    /**
     * 🎯 새 selector
     * 네이버 PC 플레이스 방문자 리뷰는 아래 구조가 가장 안정적임
     *
     * div#_review_section > script 태그 내 JSON 데이터 포함됨
     * → HTML 파싱 대신 JSON 파싱 방식 사용 (가장 안정적)
     */

    const dataScript = $("script#_review_data");
    if (!dataScript.length) {
      console.log("⚠️ 리뷰 데이터 스크립트를 찾을 수 없음.");
      return 0;
    }

    // 스크립트 내부 JSON 파싱
    const json = JSON.parse(dataScript.html() || "{}");

    const items = json?.items ?? [];
    if (!items.length) {
      console.log("⚠️ 리뷰 데이터 없음");
      return 0;
    }

    for (const item of items) {
      reviews.push({
        reviewId: item.reviewId,
        content: item.reviewContent,
        rating: item.rating ?? 0,
        date: item.regTime ?? "",
        platform: "Naver",
      });
    }

    // ================================
    // DB 저장 + summary 자동 생성
    // ================================
    let added = 0;

    for (const r of reviews) {
      // 리뷰 ID 기반 중복 체크 (content보다 훨씬 안전)
      const exists = await prisma.review.findFirst({
        where: { userId, rawJson: { path: ["naverId"], equals: r.reviewId } },
      });

      if (exists) continue;

      // 신규 저장
      const newReview = await prisma.review.create({
        data: {
          userId,
          platform: "Naver",
          rating: r.rating,
          content: r.content,
          rawJson: { naverId: r.reviewId, date: r.date },
        },
      });

      // 요약 자동 생성
      try {
        await generateSummary(
          {
            body: {
              reviewId: newReview.id,
              content: newReview.content,
            },
          } as any, // fake Request object
          {
            json: () => {},
            status: () => ({ json: () => {} }),
          } as any
        ); // fake Response object
      } catch (e) {
        console.error("❌ 요약 생성 실패:", e);
      }

      added++;
    }

    return added;
  } catch (err) {
    console.error("❌ fetchNaverReviews Error:", err);
    return 0;
  }
}
