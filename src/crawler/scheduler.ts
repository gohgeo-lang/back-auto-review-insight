import cron from "node-cron";
import { prisma } from "../lib/prisma";
import { fetchNaverReviews } from "./naver";

// 3시간마다 실행
cron.schedule("0 */3 * * *", async () => {
  console.log("⏳ [Scheduler] 자동 리뷰 수집 시작...");

  try {
    const users = await prisma.user.findMany({
      where: { placeId: { not: null } },
    });

    if (users.length === 0) {
      console.log("⚠️ [Scheduler] placeId 가진 유저 없음");
      return;
    }

    for (const user of users) {
      try {
        if (!user.placeId) continue;

        console.log(`➡️ [Scheduler] 유저 ${user.id} 리뷰 수집 시작`);
        const count = await fetchNaverReviews(user.placeId, user.id);

        console.log(
          `[Scheduler] 유저 ${user.id}: 새 리뷰 ${count}개 수집 완료`
        );
      } catch (err) {
        console.error(
          `[Scheduler] 유저 ${user.id} 리뷰 수집 중 오류 발생:`,
          err
        );
      }
    }

    console.log("[Scheduler] 전체 리뷰 수집 작업 완료");
  } catch (err) {
    console.error("[Scheduler] 전체 작업 에러:", err);
  }
});
