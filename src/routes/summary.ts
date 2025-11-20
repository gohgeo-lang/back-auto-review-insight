import { Router } from "express";
import { prisma } from "../lib/prisma";

const router = Router();

router.get("/:reviewId", async (req, res) => {
  const { reviewId } = req.params;

  const summary = await prisma.summary.findUnique({
    where: { reviewId },
  });

  res.json(summary);
});

export default router;
