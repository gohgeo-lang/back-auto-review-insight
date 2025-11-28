import { Router } from "express";
import { extractPlaceId } from "../utils/naverPlace";
import { prisma } from "../lib/prisma";
import { fetchNaverReviews } from "../crawler/naver";
import { authMiddleware } from "../middleware/authMiddleware";

const router = Router();

// 인증 필요
router.use(authMiddleware);

// ⭐ 1) placeId 추출 API
router.post("/extract", (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: "URL_REQUIRED" });
  }

  const placeId = extractPlaceId(url);

  if (!placeId) {
    return res.status(400).json({ error: "INVALID_URL" });
  }

  return res.json({ placeId });
});

// ⭐ 2) 매장 등록 (수집은 별도 호출)
router.post("/register-store", async (req, res) => {
  const { placeId, name, url, autoCrawlEnabled, autoReportEnabled } = req.body;
  const userId = (req as any).user?.id;

  try {
    if (!placeId) {
      return res.status(400).json({ error: "PLACE_ID_REQUIRED" });
    }
    if (!userId) {
      return res.status(401).json({ error: "UNAUTHORIZED" });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: "USER_NOT_FOUND" });

    const limit = user.storeQuota ?? 1;
    const count = await prisma.store.count({ where: { userId } });
    if (count >= limit) {
      return res.status(400).json({
        error: "STORE_LIMIT_EXCEEDED",
        message: `등록 한도 초과: 현재 구독에서 최대 ${limit}개까지 등록할 수 있습니다.`,
      });
    }

    const store = await prisma.store.create({
      data: {
        userId,
        placeId,
        name,
        url,
        autoCrawlEnabled: autoCrawlEnabled !== false,
        autoReportEnabled: autoReportEnabled !== false,
      },
    });

    return res.json({
      ok: true,
      store,
      message: "Store saved. Run crawler separately to collect reviews.",
    });
  } catch (e) {
    console.error("[store/register-store] error:", e);
    return res.status(500).json({ error: "매장 등록 실패", detail: String(e) });
  }
});

// ⭐ 3) 매장 목록
router.get("/", async (req, res) => {
  const userId = (req as any).user?.id;
  if (!userId) return res.status(401).json({ error: "UNAUTHORIZED" });
  const stores = await prisma.store.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
  return res.json(stores);
});

// 설정 업데이트 (autoCrawl/autoReport)
router.post("/settings", async (req, res) => {
  const userId = (req as any).user?.id;
  const { storeId, autoCrawlEnabled, autoReportEnabled } = req.body;

  if (!userId) return res.status(401).json({ error: "UNAUTHORIZED" });
  if (!storeId) return res.status(400).json({ error: "STORE_ID_REQUIRED" });

  const store = await prisma.store.findFirst({ where: { id: storeId, userId } });
  if (!store) return res.status(404).json({ error: "STORE_NOT_FOUND" });

  const updated = await prisma.store.update({
    where: { id: storeId },
    data: {
      autoCrawlEnabled: autoCrawlEnabled ?? store.autoCrawlEnabled,
      autoReportEnabled: autoReportEnabled ?? store.autoReportEnabled,
    },
  });

  return res.json(updated);
});

export default router;
