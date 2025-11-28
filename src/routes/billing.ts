import { Router } from "express";
import { authMiddleware } from "../middleware/authMiddleware";
import { prisma } from "../lib/prisma";

const router = Router();

router.use(authMiddleware);

// 단순 크레딧 추가 (테스트/수동 결제용)
router.post("/credits", async (req, res) => {
  const userId = (req as any).user?.id;
  const amount = Number(req.body?.amount || 0);
  if (!userId) return res.status(401).json({ error: "UNAUTHORIZED" });
  if (!amount || amount <= 0) return res.status(400).json({ error: "INVALID_AMOUNT" });

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return res.status(404).json({ error: "USER_NOT_FOUND" });

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { extraCredits: (user.extraCredits || 0) + amount },
  });

  return res.json({ ok: true, extraCredits: updated.extraCredits });
});

export default router;
