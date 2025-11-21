import { Router } from "express";
import { getSummary } from "../controllers/summaryController";

const router = Router();

// 특정 리뷰의 요약 조회
router.get("/:reviewId", getSummary);

export default router;
