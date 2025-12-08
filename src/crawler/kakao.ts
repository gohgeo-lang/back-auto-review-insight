import puppeteer, { Browser, Page } from "puppeteer";
import { prisma } from "../lib/prisma";
import crypto from "crypto";

type CrawlResult = {
  count: number;
  logs: string[];
};

type KakaoReview = {
  content: string;
  writer?: string;
  date?: string;
};

function makeReviewId(placeId: string, author: string | null, content: string) {
  const hash = crypto.createHash("md5").update(`${author || ""}-${content}`).digest("hex").slice(0, 8);
  return `${placeId}-${hash}`;
}

/**
 * 카카오맵 DOM 크롤러
 * - 후기 탭 클릭 → 최신순 정렬 → 스크롤로 로드
 * - 더보기 버튼 없이 스크롤만으로 로드됨
 */
export async function fetchKakaoReviews(
  placeId: string,
  userId: string,
  storeId?: string,
  maxReviews = 300
): Promise<CrawlResult> {
  const logs: string[] = [];
  let browser: Browser | null = null;

  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--window-size=1280,800"],
    });

    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

    logs.push("페이지 접속 중...");
    await page.goto(`https://place.map.kakao.com/${placeId}`, { waitUntil: "networkidle2", timeout: 60000 });

    // 후기 탭 클릭
    try {
      const tab = await page.waitForSelector("a.link_tab[href='#review']", { timeout: 15000 });
      await tab?.click();
      await sleep(1200);
    } catch {
      logs.push("후기 탭을 찾지 못했습니다.");
    }

    // 최신순 정렬 시도
    try {
      const sortBtn = await page.$("span.ico_mapdesc.ico_sort");
      if (sortBtn) {
        await sortBtn.click();
        await sleep(400);
        const sortLinks = await page.$$("a.link_sort");
        for (const link of sortLinks) {
          const txt = await page.evaluate((el) => el.textContent || "", link);
          if (txt.includes("최신")) {
            await link.click();
            await sleep(800);
            break;
          }
        }
      }
    } catch {
      // 정렬 실패해도 계속 진행
    }

    await loadAllKakaoReviews(page, maxReviews, logs);

    const reviews = await extractReviews(page);

    let saved = 0;
    for (const r of reviews) {
      if (saved >= maxReviews) break;
      const text = (r.content || "").trim();
      if (!text) continue;
      const reviewId = makeReviewId(placeId, r.writer || null, text);
      const exists = await prisma.review.findFirst({
        where: { userId, storeId: storeId || undefined, reviewId },
      });

      if (exists) {
        await prisma.review.update({
          where: { id: exists.id },
          data: {
            content: r.writer ? `${r.writer}: ${text}` : text,
            platform: "Kakao",
            storeId: storeId || undefined,
            createdAt: r.date ? new Date(r.date) : undefined,
          },
        });
      } else {
        await prisma.review.create({
          data: {
            userId,
            storeId: storeId || undefined,
            reviewId,
            content: r.writer ? `${r.writer}: ${text}` : text,
            platform: "Kakao",
            rating: 0,
            createdAt: r.date ? new Date(r.date) : undefined,
          },
        });
        saved += 1;
      }
    }

    logs.push(`수집 완료: ${saved}개`);
    return { count: saved, logs };
  } catch (err) {
    console.error("[Kakao Crawler] fetch failed:", err);
    logs.push("수집 실패");
    return { count: 0, logs };
  } finally {
    if (browser) await browser.close();
  }
}

async function loadAllKakaoReviews(page: Page, maxReviews: number, logs: string[]) {
  let lastCount = 0;
  let stable = 0;
  const MAX_LOOPS = 200;
  const STABLE_LIMIT = 8;

  for (let i = 0; i < MAX_LOOPS; i++) {
    await page.evaluate(() => window.scrollBy(0, document.body.scrollHeight));
    await sleep(1200);

    const count = await page.$$eval(
      "div.comment_info, div.evaluation_review, li.list_evaluation_item, li",
      (els) => els.length
    );

    if (count >= maxReviews) {
      logs.push(`↳ 로드된 리뷰: ${count}`);
      break;
    }

    if (count === lastCount) {
      stable += 1;
    } else {
      stable = 0;
      if (count && count % 40 === 0) {
        logs.push(`↳ 로드된 리뷰: ${count}`);
      }
    }
    lastCount = count;

    if (stable >= STABLE_LIMIT) break;
  }
}

async function extractReviews(page: Page): Promise<KakaoReview[]> {
  const reviews = await page.evaluate(() => {
    const results: { content: string; writer?: string; date?: string }[] = [];
    const nodes =
      document.querySelectorAll("p.desc_review") ||
      document.querySelectorAll("div.comment_info, div.evaluation_review, li.list_evaluation_item, li");

    nodes.forEach((el) => {
      // 본문: desc_review 우선, 없으면 기존 후보
      let content =
        (el as HTMLElement).querySelector?.("p.desc_review")?.textContent?.trim() ||
        (el as HTMLElement).querySelector?.(".txt_comment")?.textContent?.trim() ||
        (el as HTMLElement).querySelector?.(".comment_txt")?.textContent?.trim() ||
        (el as HTMLElement).querySelector?.(".comment")?.textContent?.trim() ||
        el.textContent?.trim() ||
        "";

      if (!content) return;
      // "접기" 같은 토글 텍스트 제거
      content = content.replace(/접기\s*$/g, "").trim();
      if (!content) return;

      const writer =
        (el as HTMLElement).querySelector?.(".link_name")?.textContent?.trim() ||
        (el as HTMLElement).querySelector?.(".txt_name")?.textContent?.trim() ||
        undefined;

      const date =
        (el as HTMLElement).querySelector?.("span.time_write")?.textContent?.trim() ||
        (el as HTMLElement).querySelector?.("span.txt_time")?.textContent?.trim() ||
        (el as HTMLElement).querySelector?.("time")?.textContent?.trim() ||
        (el as HTMLElement).querySelector?.("span[data-tiara-layer='date']")?.textContent?.trim() ||
        undefined;

      results.push({ content, writer, date });
    });

    return results;
  });

  return reviews;
}

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));
