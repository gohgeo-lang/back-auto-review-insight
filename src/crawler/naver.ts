import axios from "axios";
import * as cheerio from "cheerio";
import { prisma } from "../lib/prisma";
import { generateSummary } from "../controllers/aiController";

// 랜덤 딜레이
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function randomDelay() {
  return 1200 + Math.random() * 1200;
}

/** -------------------------
 *  MAIN ENTRY FUNCTION
 --------------------------*/
export async function fetchNaverReviews(placeId: string, userId: string) {
  try {
    // 1) 내부 API (가장 안정적)
    const apiReviews = await tryInternalApi(placeId);
    if (apiReviews.length > 0) return await saveReviews(apiReviews, userId);

    // 2) 모바일 script JSON 파싱
    const mobReviews = await tryMobileScript(placeId);
    if (mobReviews.length > 0) return await saveReviews(mobReviews, userId);

    // 3) PC script JSON 파싱
    const pcReviews = await tryPcScript(placeId);
    if (pcReviews.length > 0) return await saveReviews(pcReviews, userId);

    // 4) 마지막 fallback: 네가 만든 DOM 기반 파싱
    const domReviews = await tryDomFallback(placeId);
    if (domReviews.length > 0) return await saveReviews(domReviews, userId);

    return 0;
  } catch (err) {
    console.error("❌ fetchNaverReviews ERROR:", err);
    return 0;
  }
}

/** ------------------------------------------
 *  1) 내부 JSON API
 -------------------------------------------*/
async function tryInternalApi(placeId: string) {
  try {
    const url = `https://m.place.naver.com/restaurant/${placeId}/review/list?reviewSort=NEWEST&isPhoto=false`;

    const res = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "X-Requested-With": "XMLHttpRequest",
      },
    });

    const items = res.data?.list || [];
    return items.map((i: any) => ({
      reviewId: i.reviewId,
      content: i.contents,
      rating: i.rating,
      date: i.regTime,
      platform: "Naver",
    }));
  } catch (_) {
    return [];
  }
}

/** ------------------------------------------
 *  2) 모바일 HTML script JSON 파싱
 -------------------------------------------*/
async function tryMobileScript(placeId: string) {
  try {
    const url = `https://m.place.naver.com/restaurant/${placeId}/review`;

    const res = await axios.get(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });

    const $ = cheerio.load(res.data);
    const script = $('script[id="_review_data"]').html();

    if (!script) return [];

    const json = JSON.parse(script);

    return json.result.review.list.map((i: any) => ({
      reviewId: i.reviewId,
      content: i.contents,
      rating: i.rating,
      date: i.regTime,
      platform: "Naver",
    }));
  } catch (_) {
    return [];
  }
}

/** ------------------------------------------
 *  3) PC HTML script JSON 파싱
 -------------------------------------------*/
async function tryPcScript(placeId: string) {
  try {
    const url = `https://place.naver.com/restaurant/${placeId}/review/visitor`;

    const res = await axios.get(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });

    const $ = cheerio.load(res.data);

    const scriptEl = $('script[type="application/json"]')
      .toArray()
      .find((el: any) => {
        const html = $(el).html();
        return html && html.includes("review");
      });

    const script = scriptEl ? $(scriptEl).html() : null;

    if (!script) return [];

    const json = JSON.parse(script);

    const items =
      json?.props?.pageProps?.dehydratedState?.queries?.[0]?.state?.data
        ?.items || [];

    return items.map((i: any) => ({
      reviewId: i.reviewId,
      content: i.contents,
      rating: i.rating,
      date: i.date,
      platform: "Naver",
    }));
  } catch (_) {
    return [];
  }
}

/** ------------------------------------------
 *  4) 마지막 fallback: 네가 만든 DOM 구조 파싱
 *  (구조 변경 대비)
 -------------------------------------------*/
async function tryDomFallback(placeId: string) {
  try {
    const url = `https://m.place.naver.com/restaurant/${placeId}/review/visitor`;

    const html = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Referer: `https://m.place.naver.com/restaurant/${placeId}/home`,
      },
    });

    const $ = cheerio.load(html.data);
    const reviews: any[] = [];

    $("li._3QDEe, li._1gpJH, li._2CVxW").each((_, el) => {
      const content =
        $(el).find("span.wo9IH").text().trim() ||
        $(el).find("span._3whw5").text().trim();

      const ratingRaw = $(el).find("span._Xkcg").text().trim();
      const rating = Number(ratingRaw) || 0;

      if (content)
        reviews.push({
          reviewId: null,
          content,
          rating,
          date: null,
          platform: "Naver",
        });
    });

    return reviews;
  } catch (_) {
    return [];
  }
}

/** ------------------------------------------
 *  리뷰 저장 + 요약 생성
 -------------------------------------------*/
async function saveReviews(list: any[], userId: string) {
  let added = 0;

  for (const r of list) {
    const exists = await prisma.review.findFirst({
      where: {
        userId,
        ...(r.reviewId ? { reviewId: r.reviewId } : { content: r.content }),
      },
    });

    if (exists) continue;

    const newReview = await prisma.review.create({
      data: {
        userId,
        reviewId: r.reviewId,
        platform: "Naver",
        rating: r.rating,
        content: r.content,
        createdAt: r.date ? new Date(r.date) : new Date(),
      },
    });

    try {
      await generateSummary(
        {
          body: {
            reviewId: newReview.id,
            content: newReview.content,
          },
        } as any,
        {
          json: () => {},
          status: () => ({ json: () => {} }),
        } as any
      );
    } catch (e) {
      console.log("summary error:", e);
    }

    added++;
    await sleep(randomDelay());
  }

  return added;
}
