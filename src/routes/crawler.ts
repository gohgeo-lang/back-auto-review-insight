import { Router } from "express";
import { fetchNaverReviews } from "../crawler/naver";
import { prisma } from "../lib/prisma";

const router = Router();

// 네이버 리뷰 수집 API
router.post("/naver", async (req, res) => {
  const { placeId, userId } = req.body;

  if (!placeId || !userId) {
    return res.status(400).json({ error: "placeId, userId 필요" });
  }

  try {
    // ⭐ 크롤러 실행 (DB 저장까지 처리)
    const addedCount = await fetchNaverReviews(placeId, userId);

    res.json({
      ok: true,
      added: addedCount,
      message: `리뷰 ${addedCount}개 저장 완료`,
    });
  } catch (e) {
    console.error("수집 실패:", e);
    res.status(500).json({ error: "리뷰 수집 실패" });
  }
});

export default router;
