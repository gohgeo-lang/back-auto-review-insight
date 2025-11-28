import { Router } from "express";
import { fetchNaverReviews } from "../crawler/naver";
import { authMiddleware } from "../middleware/authMiddleware";
import { prisma } from "../lib/prisma";

const router = Router();

// 모든 크롤링 엔드포인트는 인증 필요
router.use(authMiddleware);

// 네이버 리뷰 수집 API
router.post("/naver", async (req, res) => {
  const { placeId, storeId } = req.body;
  const userId = (req as any).user?.id;

  if (!userId) {
    return res.status(401).json({ error: "UNAUTHORIZED" });
  }

  try {
    let targetPlaceId = placeId;
    let targetStoreId: string | undefined = storeId;

    if (storeId) {
      const store = await prisma.store.findFirst({
        where: { id: storeId, userId },
      });
      if (!store) return res.status(404).json({ error: "STORE_NOT_FOUND" });
      targetPlaceId = targetPlaceId || store.placeId || undefined;
      targetStoreId = store.id;
    }

    if (!targetPlaceId) {
      return res.status(400).json({ error: "PLACE_ID_REQUIRED" });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    const store = targetStoreId
      ? await prisma.store.findFirst({ where: { id: targetStoreId, userId } })
      : null;
    if (!user) return res.status(404).json({ error: "USER_NOT_FOUND" });

    const isSubActive = user.subscriptionStatus === "active";
    const baseLimit = isSubActive ? 3000 : 300;
    const extraCredits = user.extraCredits || 0;
    const allowedMax = isSubActive ? baseLimit : baseLimit + extraCredits;
    const dayWindows = isSubActive ? [180, 365, 0] : [30, 90, 180, 365, 0];

    if (!isSubActive && allowedMax <= 0) {
      return res.status(402).json({
        error: "CREDITS_REQUIRED",
        message:
          "무료 한도를 모두 사용했습니다. 추가 크레딧을 구매하거나 구독을 활성화하세요.",
      });
    }

    // ⭐ 크롤러 실행 (DB 저장까지 처리)
    const result = await fetchNaverReviews(targetPlaceId, userId, targetStoreId, {
      maxReviews: allowedMax,
      dayWindows,
      since: store?.lastCrawledAt ?? null,
    });

    // 무료 한도 초과분에 대해 크레딧 차감
    if (!isSubActive && result.count > baseLimit) {
      const usedCredits = Math.min(extraCredits, result.count - baseLimit);
      if (usedCredits > 0) {
        await prisma.user.update({
          where: { id: userId },
          data: { extraCredits: Math.max(0, extraCredits - usedCredits) },
        });
      }
    }

    // 마지막 수집 시각 업데이트
    if (targetStoreId) {
      await prisma.store.update({
        where: { id: targetStoreId },
        data: { lastCrawledAt: new Date() },
      });
    }

    res.json({
      ok: true,
      added: result.count,
      logs: result.logs,
      message: `리뷰 ${result.count}개 저장 완료`,
      rangeDays: result.rangeDays,
      limitedBy: result.limitedBy,
    });
  } catch (e) {
    console.error("수집 실패:", e);
    res.status(500).json({ error: "리뷰 수집 실패" });
  }
});

export default router;
