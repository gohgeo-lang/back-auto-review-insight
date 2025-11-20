import { Router } from "express";
import { generateSummary, generateReply } from "../controllers/aiController";

const router = Router();

router.post("/summary", generateSummary);
router.post("/reply", generateReply);

export default router;
