import cron from "node-cron";
import { prisma } from "../lib/prisma";
import { fetchNaverReviews } from "./naver";
import { generateReportPayload } from "../services/reportService";

// 매일 새벽 3시(서버 시간 기준) 실행
cron.schedule("0 3 * * *", async () => {
  console.log("⏳ [Scheduler] 자동 리뷰 수집 시작...");

  try {
    // store 기준으로 수집
    const stores = await prisma.store.findMany({
      include: {
        user: {
          select: {
            id: true,
            subscriptionStatus: true,
            extraCredits: true,
          },
        },
      },
    });

    if (stores.length === 0) {
      console.log("⚠️ [Scheduler] 등록된 매장이 없습니다.");
      return;
    }

    for (const store of stores) {
      try {
        if (!store.placeId) continue;
        if (store.autoCrawlEnabled === false) {
          console.log(`[Scheduler] 매장 ${store.id} 자동 수집 비활성화, 건너뜀`);
          continue;
        }
        const user = store.user;
        const isSubActive = user.subscriptionStatus === "active";
        const baseLimit = isSubActive ? 3000 : 300;
        const allowedMax = isSubActive ? baseLimit : baseLimit + (user.extraCredits || 0);
        const dayWindows = isSubActive ? [180, 365, 0] : [30, 90, 180, 365, 0];

        console.log(`➡️ [Scheduler] 매장 ${store.id} 수집 시작`);
        const result = await fetchNaverReviews(store.placeId, user.id, store.id, {
          maxReviews: allowedMax,
          dayWindows,
          since: store.lastCrawledAt ?? null,
        });

        // 무료 한도 초과분 크레딧 차감
        if (!isSubActive && result.count > baseLimit) {
          const usedCredits = Math.min(
            user.extraCredits || 0,
            result.count - baseLimit
          );
          if (usedCredits > 0) {
            await prisma.user.update({
              where: { id: user.id },
              data: { extraCredits: Math.max(0, (user.extraCredits || 0) - usedCredits) },
            });
          }
        }

        // 마지막 수집 시각 업데이트
        await prisma.store.update({
          where: { id: store.id },
          data: { lastCrawledAt: new Date() },
        });

        // 자동 리포트 생성 (주간/월간/분기/연간) - 구독 사용자 + autoReportEnabled일 때만
        if (isSubActive && store.autoReportEnabled !== false) {
          const periods = [
            { period: "weekly", rangeDays: 7 },
            { period: "monthly", rangeDays: 30 },
            { period: "quarterly", rangeDays: 90 },
            { period: "yearly", rangeDays: 365 },
          ] as const;
          for (const p of periods) {
            try {
              const payload = await generateReportPayload(user.id, store.id, p.rangeDays);
              await prisma.report.create({
                data: {
                  userId: user.id,
                  storeId: store.id,
                  period: p.period,
                  rangeDays: p.rangeDays,
                  payload,
                },
              });
            } catch (err) {
              console.error(`[Scheduler] 리포트 생성 실패 (${p.period}):`, err);
            }
          }
        }

        console.log(
          `[Scheduler] 매장 ${store.id}: 새 리뷰 ${result.count}개 수집 완료`
        );
      } catch (err) {
        console.error(
          `[Scheduler] 매장 ${store.id} 수집 중 오류 발생:`,
          err
        );
      }
    }

    console.log("[Scheduler] 전체 리뷰 수집 작업 완료");
  } catch (err) {
    console.error("[Scheduler] 전체 작업 에러:", err);
  }
});
