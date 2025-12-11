import { Router } from "express";
import { fetchNaverReviews } from "../crawler/naver";
import { fetchGoogleReviews } from "../crawler/google";
import { fetchKakaoReviews } from "../crawler/kakao";
import { authMiddleware } from "../middleware/authMiddleware";
import { prisma } from "../lib/prisma";

const router = Router();
const wait = (ms: number) => new Promise((res) => setTimeout(res, ms));

// 모든 크롤링 엔드포인트는 인증 필요
router.use(authMiddleware);

// 네이버 리뷰 수집 API
router.post("/naver", async (req, res) => {
  const { placeId, storeId, skipCharge } = req.body;
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

    // storeId가 없으면 동일 placeId로 등록된 매장을 자동 매핑
    if (!targetStoreId && targetPlaceId) {
      const found = await prisma.store.findFirst({
        where: { userId, placeId: targetPlaceId },
      });
      if (found) {
        targetStoreId = found.id;
      }
    }

    // 토큰 차감/구독 여부 검사 (기본 10개 필요) - 여러 플랫폼 연속 수집 시 skipCharge로 제어
    if (!skipCharge) {
      const cost = 1; // 이용권 1회 차감
      const tokens = user.extraCredits || 0;
      if (tokens < cost) {
        return res.status(402).json({
          error: "CREDITS_REQUIRED",
          message: "이용권이 부족합니다. 충전 후 이용해주세요.",
        });
      }
      await prisma.user.update({
        where: { id: userId },
        data: { extraCredits: Math.max(0, tokens - cost) },
      });
    }

    const baseLimit = 300; // 정기 구독과 무관하게 수동 스캔은 고정 300개
    const allowedMax = baseLimit;
    const dayWindows = [30, 90, 180, 365, 0];
    const collectedAt = new Date(); // 수집 시작 시각 고정

    // ⭐ 크롤러 실행 (재시도 포함, DB 저장까지 처리)
    const maxAttempts = 3;
    let result: any = null;
    let lastError: any = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        result = await fetchNaverReviews(targetPlaceId, userId, targetStoreId, {
          maxReviews: allowedMax,
          dayWindows,
          since: store?.lastCrawledAt ?? null,
          collectedAt,
        });
        break;
      } catch (err) {
        lastError = err;
        if (attempt < maxAttempts) {
          await wait(1500);
          continue;
        }
      }
    }
    if (!result) {
      // 실패 시 토큰 환불
      await prisma.user.update({
        where: { id: userId },
        data: { extraCredits: { increment: cost } },
      });
      console.error("수집 실패(재시도 후):", lastError);
      return res.status(500).json({ error: "CRAWL_FAILED_RETRY" });
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

// 구글 리뷰 수집 API
router.post("/google", async (req, res) => {
  const { placeId, storeId, skipCharge } = req.body;
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

    if (!targetStoreId && targetPlaceId) {
      const found = await prisma.store.findFirst({
        where: { userId, placeId: targetPlaceId },
      });
      if (found) {
        targetStoreId = found.id;
      }
    }

    // 토큰 차감 (수동 스캔 10개) - 여러 플랫폼 연속 수집 시 skipCharge로 제어
    if (!skipCharge) {
      const cost = 1; // 이용권 1회 차감
      const tokens = user.extraCredits || 0;
      if (tokens < cost) {
        return res.status(402).json({
          error: "CREDITS_REQUIRED",
          message: "이용권이 부족합니다. 충전 후 이용해주세요.",
        });
      }
      await prisma.user.update({
        where: { id: userId },
        data: { extraCredits: Math.max(0, tokens - cost) },
      });
    }

    const result = await fetchGoogleReviews(targetPlaceId, userId, targetStoreId, {
      maxReviews: 300,
      collectedAt: new Date(), // 수집 시작 시각 고정
    });

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
    });
  } catch (e) {
    console.error("수집 실패:", e);
    res.status(500).json({ error: "리뷰 수집 실패" });
  }
});

// 카카오 리뷰 수집 API
router.post("/kakao", async (req, res) => {
  const { placeId, storeId, skipCharge } = req.body;
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
      targetPlaceId = targetPlaceId || store.kakaoPlaceId || store.placeId || undefined;
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

    if (!targetStoreId && targetPlaceId) {
      const found = await prisma.store.findFirst({
        where: {
          userId,
          OR: [{ kakaoPlaceId: targetPlaceId }, { placeId: targetPlaceId }],
        },
      });
      if (found) {
        targetStoreId = found.id;
      }
    }

    // 토큰 차감 (수동 스캔 10개) - 여러 플랫폼 연속 수집 시 skipCharge로 제어
    if (!skipCharge) {
      const cost = 1; // 이용권 1회 차감
      const tokens = user.extraCredits || 0;
      if (tokens < cost) {
        return res.status(402).json({
          error: "CREDITS_REQUIRED",
          message: "이용권이 부족합니다. 충전 후 이용해주세요.",
        });
      }
      await prisma.user.update({
        where: { id: userId },
        data: { extraCredits: Math.max(0, tokens - cost) },
      });
    }

    const result = await fetchKakaoReviews(targetPlaceId, userId, targetStoreId, 300, {
      collectedAt: new Date(), // 수집 시작 시각 고정
    });

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
    });
  } catch (e) {
    console.error("수집 실패:", e);
    res.status(500).json({ error: "리뷰 수집 실패" });
  }
});

export default router;
