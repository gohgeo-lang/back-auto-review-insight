import puppeteer, { Browser, Page } from "puppeteer";
import fs from "fs";
import { prisma } from "../lib/prisma";
import crypto from "crypto";

type CrawlResult = {
  count: number;
  logs: string[];
};

type CrawlOptions = {
  maxReviews?: number;
  headless?: boolean;
  keepOpen?: boolean;
};

const DEFAULT_MAX = 300;

function makeReviewId(placeId: string, reviewId: string | null, content: string) {
  if (reviewId) return `${placeId}-${reviewId}`;
  const hash = crypto.createHash("md5").update(content).digest("hex").slice(0, 8);
  return `${placeId}-${hash}`;
}

// "2 weeks ago" 등 상대시간을 Date로 변환 (대략적인 파싱)
function parseRelativeDate(text: string | null) {
  if (!text) return null;
  const now = new Date();
  const lower = text.toLowerCase();
  const num = parseInt(lower, 10);
  if (isNaN(num)) return null;
  if (lower.includes("year")) {
    now.setFullYear(now.getFullYear() - num);
    return now;
  }
  if (lower.includes("month")) {
    now.setMonth(now.getMonth() - num);
    return now;
  }
  if (lower.includes("week")) {
    now.setDate(now.getDate() - num * 7);
    return now;
  }
  if (lower.includes("day")) {
    now.setDate(now.getDate() - num);
    return now;
  }
  if (lower.includes("hour")) {
    now.setHours(now.getHours() - num);
    return now;
  }
  return null;
}

export async function fetchGoogleReviews(
  placeId: string,
  userId: string,
  storeId?: string,
  options?: CrawlOptions
): Promise<CrawlResult> {
  const maxReviews = options?.maxReviews ?? DEFAULT_MAX;
  const headless = options?.headless ?? true;
  const keepOpen = options?.keepOpen ?? false;
  const logs: string[] = [];
  let browser: Browser | null = null;

  try {
    const execPathEnv = process.env.PUPPETEER_EXECUTABLE_PATH?.trim();
    const execPath = execPathEnv && fs.existsSync(execPathEnv) ? execPathEnv : undefined;
    browser = await puppeteer.launch({
      headless,
      userDataDir: "/tmp/puppeteer-google",
      executablePath: execPath,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--window-size=1280,900",
        "--disable-crash-reporter",
        "--disable-dev-shm-usage",
      ],
    });
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

    const isCid = /0x[0-9a-f]+:0x[0-9a-f]+/i.test(placeId);
    const url = isCid
      ? `https://www.google.com/maps?cid=${placeId}`
      : `https://www.google.com/maps/place/?q=place_id:${placeId}`;
    logs.push(`페이지 접속 중... (${isCid ? "cid" : "place_id"})`);
    await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });

    // 리뷰 탭/패널 열기 시도 (요약 뷰만 보이는 경우 대비)
    await openReviewsPanel(page).catch(() => null);
    // 정렬 → 최신순 클릭 시도
    try {
      const sortButton = await page.$("span.GMtm7c");
      const sortText =
        sortButton &&
        (await page.evaluate((el) => (el as HTMLElement).innerText || "", sortButton));
      if (sortButton && sortText?.includes("정렬")) {
        await sortButton.click();
        await new Promise((r) => setTimeout(r, 500));
        // 팝업에서 "최신" 텍스트를 찾기
        const newestClicked = await page.evaluate(() => {
          const candidates = Array.from(document.querySelectorAll("div, span, button"));
          const target = candidates.find((el) => {
            const txt = (el.textContent || "").trim();
            return txt.includes("최신") || txt.toLowerCase().includes("newest");
          });
          if (target instanceof HTMLElement) {
            target.click();
            return true;
          }
          return false;
        });
        if (newestClicked) {
          await new Promise((r) => setTimeout(r, 800));
        }
      }
    } catch {
      // 정렬 실패해도 계속 진행
    }

    // 리뷰 패널이 로드되도록 스크롤 (구글은 스크롤로 리뷰 로딩)
    const scrollContainerSelector =
      'div[aria-label*="리뷰"], div[aria-label*="reviews"], div[class*="section-scrollbox"], div[role="main"]';
    await page.waitForSelector(scrollContainerSelector, { timeout: 30000 }).catch(() => null);
    let prevCount = 0;
    let stagnation = 0;
    for (let i = 0; i < 150; i++) {
      try {
        await page.evaluate((sel: string) => {
          const targets: (Element | null)[] = [
            document.querySelector(sel),
            document.querySelector("div.section-scrollbox"),
            document.querySelector("div[role='main']"),
            document.querySelector(".DxyBCb"),
            document.querySelector(".lMbq3e"),
            document.scrollingElement,
            document.body,
          ];
          targets.forEach((el) => {
            if (el && "scrollTo" in el) {
              (el as any).scrollTo(0, (el as any).scrollHeight || 999999);
            }
          });
          window.scrollTo(0, document.body.scrollHeight || 999999);
        }, scrollContainerSelector);
        // 스크롤 후 더보기 버튼 시도
        await clickMoreButton(page);
        await new Promise((r) => setTimeout(r, 2000));
        await page.waitForSelector(".jftiEf", { timeout: 5000 }).catch(() => null);
        const count = await page.$$eval(".jftiEf", (els: Element[]) => els.length);
        if (count !== prevCount) {
          logs.push(`↳ 로드된 리뷰: ${count}`);
          stagnation = 0;
          prevCount = count;
        } else {
          stagnation += 1;
          if (stagnation >= 10) break;
        }
        if (count >= maxReviews) break;
      } catch {
        break;
      }
}

async function openReviewsPanel(page: Page) {
  // 다양한 버튼/링크 시도
  const selectors = [
    'button[jsaction*="pane.rating.moreReviews"]',
    'a[href*="review"]',
    'button[aria-label*="리뷰"]',
    'button.M77dve',
    'button[role="tab"][aria-label*="리뷰"]',
  ];

  for (const sel of selectors) {
    const btn = await page.$(sel);
    if (btn) {
      await btn.click().catch(() => null);
      await new Promise((r) => setTimeout(r, 1200));
      return;
    }
  }

  // 텍스트 기반 탐색
  const clicked = await page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll("button, a"));
    const target = candidates.find((el) => {
      const txt = (el.textContent || "").trim();
      return txt.includes("리뷰") && txt.includes("더보기");
    });
    if (target instanceof HTMLElement) {
      target.click();
      return true;
    }
    return false;
  });
  if (clicked) {
    await new Promise((r) => setTimeout(r, 1200));
  }
}

async function clickMoreButton(page: Page) {
  const clicked = await page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll("button, a"));
    const target = candidates.find((el) => {
      const txt = (el.textContent || "").trim();
      const aria = (el.getAttribute("aria-label") || "").trim();
      return (
        txt.includes("리뷰 더보기") ||
        aria.includes("리뷰 더보기") ||
        aria.includes("review") ||
        txt.includes("More reviews")
      );
    });
    if (target instanceof HTMLElement) {
      target.click();
      return true;
    }
    return false;
  });
  if (clicked) await new Promise((r) => setTimeout(r, 1000));
}

    // 리뷰 추출 (본문만, 이름/점수 텍스트 제외)
    const reviews = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll(".jftiEf"));
      const results: { content: string; author?: string; dateText?: string; rating?: number; reviewId?: string | null }[] = [];

      cards.forEach((card) => {
        const content = (card.querySelector(".wiI7pd") as HTMLElement)?.innerText?.trim() || "";
        // 본문이 비어 있거나 텍스트가 없는 평가만인 경우 제외
        if (!content || content.replace(/\s+/g, "").length === 0) return;

        const author = (card.querySelector(".d4r55") as HTMLElement)?.innerText?.trim() || "";
        const dateText =
          (card.querySelector(".rsqaWe") as HTMLElement)?.innerText?.trim() ||
          (card.querySelector("span[jsinstance][aria-hidden='true']") as HTMLElement)?.innerText?.trim() ||
          "";
        const ratingEl = card.querySelector("span[role='img']") as HTMLElement | null;
        const ratingRaw = ratingEl?.getAttribute("aria-label") || ratingEl?.innerText || "";
        const match = ratingRaw.match(/([0-9.]+)/);
        const rating = match ? Number(match[1]) : 0;
        const reviewId =
          card.getAttribute("data-review-id") ||
          card.querySelector("button[jslog]")?.getAttribute("jslog") ||
          null;

        results.push({ content, author, dateText, rating, reviewId });
      });

      return results;
    });

    let saved = 0;
    for (const r of reviews) {
      const text = (r.content || "").trim();
      if (!text) continue;
      const reviewId = makeReviewId(placeId, r.reviewId, text);

      const existing = await prisma.review.findFirst({
        where: { userId, storeId: storeId || undefined, reviewId },
      });

      if (existing) {
        await prisma.review.update({
          where: { id: existing.id },
          data: {
            content: r.author ? `${r.author}: ${text}` : text,
            rating: r.rating || 0,
            platform: "Google",
            storeId: storeId || undefined,
            createdAt: parseRelativeDate(r.dateText) ?? undefined,
          },
        });
      } else {
        await prisma.review.create({
          data: {
            userId,
            storeId: storeId || undefined,
            reviewId,
            content: r.author ? `${r.author}: ${text}` : text,
            rating: r.rating || 0,
            platform: "Google",
            createdAt: parseRelativeDate(r.dateText) ?? undefined,
          },
        });
        saved += 1;
        if (saved >= maxReviews) break;
      }
    }

    logs.push(`수집 완료: ${saved}개`);
    return { count: saved, logs };
  } catch (err) {
    console.error("[Google Crawler] fetch failed:", err);
    logs.push("수집 실패");
    return { count: 0, logs };
  } finally {
    if (browser && !keepOpen) await browser.close().catch(() => {});
  }
}
