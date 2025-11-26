import puppeteer from "puppeteer";
import { prisma } from "../lib/prisma";
import crypto from "crypto";

type CrawlResult = { count: number; logs: string[] };

/**
 * 네이버 플레이스에서 리뷰를 수집해 Prisma에 저장
 * - 공식 API가 차단될 수 있어 실제 DOM을 통해 수집
 * - reviewId가 노출되지 않는 경우가 있어 placeId+본문 일부로 surrogate key 생성
 */
export async function fetchNaverReviews(
  placeId: string,
  userId: string
): Promise<CrawlResult> {
  let browser: puppeteer.Browser | null = null;
  const logs: string[] = [];

  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled",
        "--window-size=1280,800",
      ],
    });

    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

    logs.push("페이지 접속 중...");
    await page.goto(`https://map.naver.com/p/entry/place/${placeId}`, {
      waitUntil: "networkidle2",
      timeout: 60000,
    });

    let frame: puppeteer.Frame | null = null;
    try {
      logs.push("⏳ iframe 로드 대기...");
      const iframeHandle = await page.waitForSelector("iframe#entryIframe", {
        timeout: 40000,
      });
      frame = await iframeHandle?.contentFrame();
    } catch {
      frame = null;
    }

    // fallback: 모바일 페이지 메인 프레임에서 시도
    if (!frame) {
      logs.push("모바일 페이지로 이동...");
      await page.goto(`https://m.place.naver.com/restaurant/${placeId}/home`, {
        waitUntil: "networkidle2",
        timeout: 60000,
      });
      frame = page.mainFrame();
    }

    if (!frame) return { count: 0, logs };
    logs.push("↳ 네이버 페이지 진입, 리뷰 영역 대기 중...");

    // 리뷰 탭 클릭
    const reviewTab =
      (await frame.$('a[role="tab"][href*="review"]')) ||
      (await frame.$('a[aria-label*="리뷰"]')) ||
      (await frame.$('button[aria-label*="리뷰"]'));
    if (reviewTab) {
      await reviewTab.click();
      await frame.evaluate(() => new Promise((r) => setTimeout(r, 1200)));
    }

    // 리뷰 리스트 로드 대기 (본문 클래스 기준, 실패해도 계속 진행)
    await frame
      .waitForSelector(".pui__vn15t2", { timeout: 20000 })
      .catch(() => null);

    // 스크롤 + 더보기 반복으로 최대한 많은 리뷰 로드
    // 충분히 깊이 내려가도록 반복 횟수 상향 (대형 매장 대응)
    await loadAllReviews(frame, 200, logs);

    // 리뷰 추출
    if (frame.isDetached()) {
      console.warn("[Crawler] frame detached before evaluate");
      return { count: 0, logs };
    }

    const reviews = await frame.evaluate(() => {
      const result: { content: string; author?: string; dateText?: string }[] =
        [];
      const contentEls = document.querySelectorAll(".pui__vn15t2");

      contentEls.forEach((el) => {
        const content = el.textContent?.trim();
        if (!content) return;
        const parent = el.closest("li") || el.closest("div");
        const authorEl =
          parent?.querySelector("a[href*='profile']") ||
          parent?.querySelector("[data-testid*='nick']") ||
          parent?.querySelector("span[class*='nickname']") ||
          parent?.querySelector("strong");
        const author = authorEl?.textContent?.trim() || undefined;
        const dateCandidate =
          Array.from(
            parent?.querySelectorAll("span, div, time") || []
          ).map((el) => el.textContent?.trim() || "")
          .find(
            (t) =>
              t.includes("방문일") ||
              /\d{4}년/.test(t) ||
              /\d{4}\.\d{1,2}\.\d{1,2}/.test(t) ||
              /\d{1,2}\.\d{1,2}/.test(t)
          ) || undefined;

        result.push({ content, author, dateText: dateCandidate });
      });

      // fallback: 예전 셀렉터 기반으로라도 긁어오기
      if (result.length === 0) {
        const selectors = [
          "section[aria-label*='리뷰'] ul li",
          "ul.list_place_reviews li",
          "li.place_section_content__item",
          "li.place_apply_pui",
          "li[data-testid*='review']",
        ];
        selectors.forEach((sel) => {
          document.querySelectorAll(sel).forEach((li) => {
            const content = li.textContent?.trim();
            if (!content) return;
            const authorEl =
              li.querySelector("a[href*='profile']") ||
              li.querySelector("[data-testid*='nick']") ||
              li.querySelector("span[class*='nickname']") ||
              li.querySelector("strong");
            const author = authorEl?.textContent?.trim() || undefined;
            const dateCandidate =
              Array.from(li.querySelectorAll("span, div, time")).map(
                (el) => el.textContent?.trim() || ""
              ).find(
                (t) =>
                  t.includes("방문일") ||
                  /\d{4}년/.test(t) ||
                  /\d{4}\.\d{1,2}\.\d{1,2}/.test(t) ||
                  /\d{1,2}\.\d{1,2}/.test(t)
              ) || undefined;
            result.push({ content, author, dateText: dateCandidate });
          });
        });
      }

      return result;
    });

    // Prisma에 저장/업데이트
    let newCount = 0;
    for (const item of reviews) {
      const rawContent = (item.content || "").trim();
      const cleaned = cleanReviewText(rawContent);
      const content = cleaned || rawContent; // 정제 결과가 비어도 원문 저장
      if (!content) continue;
      const author = item.author?.trim();
      const reviewId = makeReviewId(placeId, `${author || ""}-${content}`); // surrogate key

      const reviewDate = item.dateText ? parseReviewDate(item.dateText) : null;

      const existing = await prisma.review.findFirst({
        where: { userId, reviewId },
      });

      if (existing) {
        await prisma.review.update({
          where: { id: existing.id },
          data: {
            content: formatDisplayContent(author, content),
            platform: "Naver",
          },
        });
      } else {
        await prisma.review.create({
          data: {
            userId,
            reviewId,
            content: formatDisplayContent(author, content),
            rating: 0,
            platform: "Naver",
            createdAt: reviewDate ?? undefined,
          },
        });
        newCount += 1;
      }
    }

    logs.push(`수집 완료: ${newCount}개`);
    return { count: newCount, logs };
  } catch (err) {
    console.error("[Crawler] Naver fetch failed:", err);
    return { count: 0, logs: [...logs, "수집 실패"] }; // 상위에서 경고만 띄우도록
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

// 불필요한 안내/메타 텍스트를 제거해 본문만 남긴다
function cleanReviewText(raw: string) {
  if (!raw) return "";
  let text = raw.replace(/\s+/g, " ").trim();
  // 접미 텍스트/태그 제거
  const noisePhrases = [
    /더보기.*$/i,
    /펼쳐보기.*$/i,
    /반응 남기기.*$/i,
    /방문일.*$/i,
    /\+\d+개의 리뷰가 더 있습니다.*$/i,
    /커피가 맛있어요.*$/i,
    /음료가 맛있어요.*$/i,
    /디저트가 맛있어요.*$/i,
    /인테리어가 멋져요.*$/i,
    /뷰가 좋아요.*$/i,
    /분위기가 좋아요.*$/i,
    /서비스가 친절해요.*$/i,
    /가격이 합리적이에요.*$/i,
    /재방문 의사있어요.*$/i,
  ];
  noisePhrases.forEach((re) => {
    text = text.replace(re, "");
  });
  // 리뷰어 정보, 팔로워 숫자 등 제거 (한글/영문 닉네임 + 숫자 패턴)
  text = text.replace(
    /^[^\d가-힣A-Za-z]{0,10}[가-힣A-Za-z0-9_*]+리뷰\s+\d+.*?(점심|저녁|오전|오후|평일|주말)/,
    ""
  );
  // 태그/키워드 파이프 구분 제거
  text = text.replace(/(\s*\|\s*)+/g, " ");
  text = text.replace(
    /(점심에 방문|저녁에 방문|예약 없이 이용|대기 시간 바로 입장|여행|혼자|데이트|일상|친구|연인|배우자|가족) ?/gi,
    ""
  );
  return text.trim();
}

function makeReviewId(placeId: string, content: string) {
  const hash = crypto
    .createHash("md5")
    .update(content)
    .digest("hex")
    .slice(0, 8);
  return `${placeId}-${hash}`;
}

function formatDisplayContent(author: string | undefined, content: string) {
  if (author) return `${author}: ${content}`;
  return content;
}

function parseReviewDate(text: string) {
  const cleaned = text.replace(/방문일/gi, "").trim();
  // YYYY년 MM월 DD일 또는 YYYY.MM.DD
  const fullMatch = cleaned.match(
    /(\d{4})[년.\-/\s]+(\d{1,2})[월.\-/\s]+(\d{1,2})/
  );
  if (fullMatch) {
    const [, y, m, d] = fullMatch;
    return new Date(Number(y), Number(m) - 1, Number(d));
  }
  // MM.DD 형태 (올해 기준)
  const mdMatch = cleaned.match(/(\d{1,2})[.\-/](\d{1,2})/);
  if (mdMatch) {
    const [, m, d] = mdMatch;
    const now = new Date();
    return new Date(now.getFullYear(), Number(m) - 1, Number(d));
  }
  return null;
}

async function clickLoadMore(frame: puppeteer.Frame, maxTries: number) {
  for (let i = 0; i < maxTries; i++) {
    const clicked = await frame.evaluate(() => {
      const section =
        document.querySelector("section[aria-label*='리뷰']") ||
        document.querySelector("section[data-testid*='review']");
      const candidates = Array.from(
        section?.querySelectorAll("a, button") ??
          document.querySelectorAll("a, button")
      ) as HTMLElement[];
      const target = candidates.find((el) => {
        const text = el.textContent || "";
        const cls = el.getAttribute("class") || "";
        return (
          text.includes("펼쳐서 더보기") ||
          (cls.includes("fvwqf") && text.includes("더보기"))
        );
      });
      if (target) {
        target.click();
        return true;
      }
      return false;
    });

    if (!clicked) break;
    await frame.evaluate(() => new Promise((r) => setTimeout(r, 1200)));
  }
}

async function loadAllReviews(
  frame: puppeteer.Frame,
  maxLoops: number,
  logs: string[]
) {
  let prevCount = 0;
  for (let i = 0; i < maxLoops; i++) {
    if (frame.isDetached()) {
      console.warn("[Crawler] frame detached during loadAllReviews");
      break;
    }
    await clickLoadMore(frame, 5);
    await frame.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await frame.evaluate(() => new Promise((r) => setTimeout(r, 1500)));

    let count = prevCount;
    try {
      count = await frame.$$eval(".pui__vn15t2", (els) => els.length);
    } catch (err) {
      console.warn("[Crawler] $$eval failed, maybe navigation occurred:", err);
      break;
    }
    if (count !== prevCount) {
      console.log(`↳ 로드된 리뷰: ${count}`);
      logs.push(`↳ 로드된 리뷰: ${count}`);
    }
    if (count === prevCount) break;
    prevCount = count;
  }
}
