import { Router } from "express";
import { saveReply, getReply } from "../controllers/replycontroller";

const router = Router();

// 응대문 생성/업데이트
router.post("/", saveReply);

// 특정 리뷰의 응대문 조회
router.get("/:reviewId", getReply);

export default router;
