import { Router } from "express";
import { fetchNaverReviews } from "../crawler/naver";
import { authMiddleware } from "../middleware/authMiddleware";

const router = Router();

// 모든 크롤링 엔드포인트는 인증 필요
router.use(authMiddleware);

// 네이버 리뷰 수집 API
router.post("/naver", async (req, res) => {
  const { placeId } = req.body;
  const userId = (req as any).user?.id;

  if (!placeId) {
    return res.status(400).json({ error: "placeId 필요" });
  }
  if (!userId) {
    return res.status(401).json({ error: "UNAUTHORIZED" });
  }

  try {
    // ⭐ 크롤러 실행 (DB 저장까지 처리)
    const result = await fetchNaverReviews(placeId, userId);

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
