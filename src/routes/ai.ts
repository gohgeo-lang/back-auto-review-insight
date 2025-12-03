import { Router } from "express";
import {
  generateSummary,
  generateReply,
  generateMissingSummaries,
  generateBatchSummaries,
  generateFinalInsight,
} from "../controllers/aiController";

const router = Router();

router.post("/summary", generateSummary);
router.post("/summary/missing", generateMissingSummaries);
router.post("/summary/batch", generateBatchSummaries);
router.post("/insight/report", generateFinalInsight);
router.post("/reply", generateReply);

export default router;
