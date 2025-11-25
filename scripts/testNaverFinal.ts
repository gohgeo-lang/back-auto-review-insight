import puppeteer from "puppeteer";

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
  await frame.waitForSelector(
    "section[aria-label*='리뷰'] ul li, ul.list_place_reviews li, div.place_section_content ul li",
    {
      timeout: 30000,
    }
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

  console.log("📦 리뷰 추출...");
  const reviews = await frame.evaluate(() => {
    const result: { content: string }[] = [];
    const selectors = [
      "section[aria-label*='리뷰'] ul li",
      "ul.list_place_reviews li",
      "li.place_section_content__item",
      "li.place_apply_pui",
      "li[data-testid*='review']",
    ];

    const dedup = new Set<string>();
    selectors.forEach((sel) => {
      document.querySelectorAll(sel).forEach((el) => {
        const content = el.textContent?.trim() ?? "";
        if (!content) return;
        const short = content.replace(/\s+/g, " ");
        if (!dedup.has(short)) {
          dedup.add(short);
          result.push({ content: short });
        }
      });
    });

    return result;
  });

  console.log("✅ 총 리뷰:", reviews.length);
  console.log(reviews.slice(0, 5));

  await browser.close();
  return reviews;
}

const placeId = process.argv[2];
if (!placeId) {
  console.log("❌ placeId 필요");
  process.exit(1);
}
crawlNaverReviews(placeId);
