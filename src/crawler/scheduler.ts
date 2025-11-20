import cron from "node-cron";
import { prisma } from "../lib/prisma";
import { fetchNaverReviews } from "./naver";

// 매 3시간마다 실행
cron.schedule("0 */3 * * *", async () => {
  console.log("⏳ 자동 리뷰 수집 실행...");

  const users = await prisma.user.findMany({
    where: { placeId: { not: null } },
  });

  for (const u of users) {
    try {
      if (!u.placeId) continue;
      const count = await fetchNaverReviews(u.placeId, u.id);
      console.log(`유저 ${u.id}: ${count}개 리뷰 업데이트`);
    } catch (e) {
      console.log("오류:", e);
    }
  }
});
