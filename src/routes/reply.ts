import { Router } from "express";
import { prisma } from "../lib/prisma";

const router = Router();

// 응대문 저장
router.post("/", async (req, res) => {
  const { reviewId, content, tone } = req.body;

  if (!reviewId || !content)
    return res.status(400).json({ error: "reviewId, content 필요" });

  const reply = await prisma.reply.upsert({
    where: { reviewId },
    update: { content, tone },
    create: { reviewId, content, tone },
  });

  res.json(reply);
});

// 응대문 조회
router.get("/:reviewId", async (req, res) => {
  const { reviewId } = req.params;
  const reply = await prisma.reply.findUnique({ where: { reviewId } });
  res.json(reply);
});

export default router;
