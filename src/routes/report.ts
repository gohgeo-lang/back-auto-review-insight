import { Router } from "express";
import { authMiddleware } from "../middleware/authMiddleware";
import { generateReport, getReports } from "../controllers/reportController";

const router = Router();

router.use(authMiddleware);
router.post("/generate", generateReport);
router.get("/", getReports);

export default router;
