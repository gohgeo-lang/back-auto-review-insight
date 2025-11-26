import puppeteer, { Frame } from "puppeteer";
import fs from "fs";

async function crawlNaverReviews(placeId: string) {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
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

  console.log("⏳ 페이지 접속중...");
  await page.goto(`https://map.naver.com/p/entry/place/${placeId}`, {
    waitUntil: "networkidle2",
    timeout: 60000,
  });

  console.log("⏳ iframe 로드 대기...");
  const iframeHandle = await page.waitForSelector("iframe#entryIframe", {
    timeout: 30000,
  });

  const frame = await iframeHandle!.contentFrame();
  if (!frame) {
    console.log("❌ iframe contentFrame 불러오기 실패");
    await browser.close();
    return [];
  }

  // 리뷰 탭 클릭 (홈이 기본일 수 있음)
  const reviewTab =
    (await frame.$('a[role="tab"][href*="review"]')) ||
    (await frame.$('a[aria-label*="리뷰"]')) ||
    (await frame.$('button[aria-label*="리뷰"]'));
  if (reviewTab) {
    await reviewTab.click();
    await frame.evaluate(() => new Promise((r) => setTimeout(r, 1200)));
  }

  console.log("⏳ 리뷰 영역 대기...");
  await frame.waitForSelector(".pui__vn15t2").catch(() => null);

  // 스크롤 + 더보기 반복
  await loadAllReviews(frame, 40);

  // 디버그 스냅샷
  const stamp = Date.now();
  await page.screenshot({ path: `scripts/debug-review-${stamp}.png`, fullPage: true });
  const html = await frame.content();
  fs.writeFileSync(`scripts/debug-review-${stamp}.html`, html);

  console.log("📦 리뷰 추출...");
  const reviews = await frame.evaluate(() => {
    const result: { content: string; author?: string }[] = [];
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
      result.push({ content, author });
    });

    // fallback
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
          result.push({ content, author });
        });
      });
    }

    return result;
  });

  console.log("✅ 총 리뷰:", reviews.length);
  console.log(reviews.slice(0, 5));

  await browser.close();
  return reviews;
}

async function loadAllReviews(frame: Frame, maxLoops: number) {
  let prevCount = 0;
  for (let i = 0; i < maxLoops; i++) {
    await clickLoadMore(frame, 3);
    await frame.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await frame.evaluate(() => new Promise((r) => setTimeout(r, 1000)));

    const count = await frame.$$eval(".pui__vn15t2", (els: Element[]) => els.length);
    if (count === prevCount) break;
    prevCount = count;
    console.log(`↳ 로드된 리뷰: ${count}`);
  }
}

async function clickLoadMore(frame: Frame, maxTries: number) {
  for (let i = 0; i < maxTries; i++) {
    const clicked = await frame.evaluate(() => {
      const section =
        document.querySelector("section[aria-label*='리뷰']") ||
        document.querySelector("section[data-testid*='review']");
      const candidates = Array.from(
        section?.querySelectorAll("a, button") ?? document.querySelectorAll("a, button")
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
    await frame.evaluate(() => new Promise((r) => setTimeout(r, 800)));
  }
}

const placeId = process.argv[2];
if (!placeId) {
  console.log("❌ placeId 필요");
  process.exit(1);
}
crawlNaverReviews(placeId);
