import puppeteer from "puppeteer";
import { prisma } from "../lib/prisma";
import crypto from "crypto";

/**
 * 네이버 플레이스에서 리뷰를 수집해 Prisma에 저장
 * - 공식 API가 차단될 수 있어 실제 DOM을 통해 수집
 * - reviewId가 노출되지 않는 경우가 있어 placeId+본문 일부로 surrogate key 생성
 */
export async function fetchNaverReviews(placeId: string, userId: string) {
  const browser = await puppeteer.launch({
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

  await page.goto(`https://map.naver.com/p/entry/place/${placeId}`, {
    waitUntil: "networkidle2",
    timeout: 60000,
  });

  const iframeHandle = await page.waitForSelector("iframe#entryIframe", {
    timeout: 30000,
  });
  const frame = await iframeHandle!.contentFrame();
  if (!frame) {
    await browser.close();
    return 0;
  }

  // 리뷰 탭 클릭
  const reviewTab =
    (await frame.$('a[role="tab"][href*="review"]')) ||
    (await frame.$('a[aria-label*="리뷰"]')) ||
    (await frame.$('button[aria-label*="리뷰"]'));
  if (reviewTab) {
    await reviewTab.click();
    await frame.evaluate(() => new Promise((r) => setTimeout(r, 1200)));
  }

  // 리뷰 리스트 로드 대기
  await frame.waitForSelector(
    "section[aria-label*='리뷰'] ul li, ul.list_place_reviews li, div.place_section_content ul li",
    { timeout: 30000 }
  );

  // 스크롤로 모든 리뷰 로딩
  let prev = 0;
  while (true) {
    const height = await frame.evaluate(() => document.body.scrollHeight);
    if (height === prev) break;
    prev = height;
    await frame.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await new Promise((r) => setTimeout(r, 1300));
  }

  // 리뷰 추출
  const reviews = await frame.evaluate(() => {
    const result: { content: string; author?: string }[] = [];
    const listItems = document.querySelectorAll(
      "section[aria-label*='리뷰'] ul li, ul.list_place_reviews li, li.place_section_content__item, li.place_apply_pui, li[data-testid*='review']"
    );

    listItems.forEach((li) => {
      const contentEl = li.querySelector(".pui__vn15t2") || li.querySelector("[class*='pui__vn15t2']");
      const content = contentEl?.textContent?.trim();
      if (!content) return;

      const authorEl =
        li.querySelector("a[href*='profile']") ||
        li.querySelector("[data-testid*='nick']") ||
        li.querySelector("span[class*='nickname']") ||
        li.querySelector("strong");
      const author = authorEl?.textContent?.trim() || undefined;

      result.push({ content, author });
    });

    return result;
  });

  await browser.close();

  // Prisma에 저장/업데이트
  let newCount = 0;
  for (const item of reviews) {
    const content = cleanReviewText(item.content);
    if (!content) continue;
    const author = item.author?.trim();
    const reviewId = makeReviewId(placeId, `${author || ""}-${content}`); // surrogate key

    const existing = await prisma.review.findFirst({
      where: { userId, reviewId },
    });

    if (existing) {
      await prisma.review.update({
        where: { id: existing.id },
        data: { content: formatDisplayContent(author, content), platform: "Naver" },
      });
    } else {
      await prisma.review.create({
        data: {
          userId,
          reviewId,
          content: formatDisplayContent(author, content),
          rating: 0,
          platform: "Naver",
        },
      });
      newCount += 1;
    }
  }

  return newCount;
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
  text = text.replace(/^[^\d가-힣A-Za-z]{0,10}[가-힣A-Za-z0-9_*]+리뷰\s+\d+.*?(점심|저녁|오전|오후|평일|주말)/, "");
  // 태그/키워드 파이프 구분 제거
  text = text.replace(/(\s*\|\s*)+/g, " ");
  text = text.replace(/(점심에 방문|저녁에 방문|예약 없이 이용|대기 시간 바로 입장|여행|혼자|데이트|일상|친구|연인|배우자|가족) ?/gi, "");
  return text.trim();
}

function makeReviewId(placeId: string, content: string) {
  const hash = crypto.createHash("md5").update(content).digest("hex").slice(0, 8);
  return `${placeId}-${hash}`;
}

function formatDisplayContent(author: string | undefined, content: string) {
  if (author) return `${author}: ${content}`;
  return content;
}
