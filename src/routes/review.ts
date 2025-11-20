import { Router } from "express";
import {
  getReviews,
  getReview,
  createReview,
} from "../controllers/reviewController";

const router = Router();

router.get("/", getReviews);
router.get("/:id", getReview);
router.post("/", createReview);

export default router;
