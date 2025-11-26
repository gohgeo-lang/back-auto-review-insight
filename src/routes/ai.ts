import { Router } from "express";
import {
  generateSummary,
  generateReply,
  generateMissingSummaries,
} from "../controllers/aiController";

const router = Router();

router.post("/summary", generateSummary);
router.post("/summary/missing", generateMissingSummaries);
router.post("/reply", generateReply);

export default router;
