import { Router } from "express";
import { extractPlaceId } from "../utils/naverPlace";
import { prisma } from "../lib/prisma";
import { fetchNaverReviews } from "../crawler/naver";

const router = Router();

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

// ⭐ 2) 매장 등록 + 자동 첫 수집
router.post("/register-store", async (req, res) => {
  const { userId, placeId } = req.body;

  try {
    await prisma.user.update({
      where: { id: userId },
      data: { placeId },
    });

    const count = await fetchNaverReviews(placeId, userId);

    return res.json({
      ok: true,
      placeId,
      collected: count,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "매장 등록 실패" });
  }
});

export default router;
