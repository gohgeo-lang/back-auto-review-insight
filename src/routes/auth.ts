import { Router } from "express";
import {
  signup,
  login,
  setStoreUrl,
  completeOnboarding,
} from "../controllers/authController";
import { authMiddleware } from "../middleware/authMiddleware";

const router = Router();

router.post("/signup", signup);
router.post("/login", login);

router.post("/set-store", authMiddleware, setStoreUrl);
router.post(
  "/complete-onboarding",
  authMiddleware,
  completeOnboarding
);

export default router;
