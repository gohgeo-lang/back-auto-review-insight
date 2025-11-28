import { Router } from "express";
import {
  signup,
  login,
  setStoreUrl,
  completeOnboarding,
  updateProfile,
  me,
} from "../controllers/authController";
import { authMiddleware } from "../middleware/authMiddleware";

const router = Router();

router.post("/signup", signup);
router.post("/login", login);
router.get("/me", authMiddleware, me);

router.post("/set-store", authMiddleware, setStoreUrl);
router.post(
  "/complete-onboarding",
  authMiddleware,
  completeOnboarding
);
router.post("/profile", authMiddleware, updateProfile);

export default router;
