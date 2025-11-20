import { Router } from "express";
import { extractPlaceId } from "../utils/naverPlace";
import { prisma } from "../lib/prisma";
import { fetchNaverReviews } from "../crawler/naver";

const router = Router();

router.post("/register-store", async (req, res) => {
  const { userId, placeId } = req.body;

  try {
    await prisma.user.update({
      where: { id: userId },
      data: { placeId },
    });

    // ⭐ placeId 저장 성공 → 리뷰 자동 수집
    const count = await fetchNaverReviews(placeId, userId);

    return res.json({
      ok: true,
      placeId,
      collected: count,
    });
  } catch (e) {
    return res.status(500).json({ error: "매장 등록 실패" });
  }
});

export default router;
