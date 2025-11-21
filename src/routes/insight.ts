// routes/insight.ts
import { Router } from "express";
import { getInsights } from "../controllers/insightController";

const router = Router();

// 로그인한 유저의 전체 인사이트
router.get("/", getInsights);

export default router;
