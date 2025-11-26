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
  const { placeId } = req.body;
  const userId = (req as any).user?.id;

  try {
    if (!placeId) {
      return res.status(400).json({ error: "PLACE_ID_REQUIRED" });
    }
    if (!userId) {
      return res.status(401).json({ error: "UNAUTHORIZED" });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({ error: "USER_NOT_FOUND" });
    }

    await prisma.user.update({
      where: { id: userId },
      data: { placeId },
    });

    return res.json({
      ok: true,
      placeId,
      collected: 0,
      message: "Store saved. Run crawler separately to collect reviews.",
    });
  } catch (e) {
    console.error("[store/register-store] error:", e);
    return res.status(500).json({ error: "매장 등록 실패", detail: String(e) });
  }
});

export default router;
