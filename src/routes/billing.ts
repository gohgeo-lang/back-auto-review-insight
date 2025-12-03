import { Router } from "express";
import { authMiddleware } from "../middleware/authMiddleware";
import { prisma } from "../lib/prisma";

const router = Router();

router.use(authMiddleware);

// 매장별 정기 리포트 구독 활성화 (월 3000원 가정, 결제 로직은 미구현)
router.post("/subscribe-store", async (req, res) => {
  const userId = (req as any).user?.id;
  const storeId = req.body?.storeId as string | undefined;
  if (!userId) return res.status(401).json({ error: "UNAUTHORIZED" });
  if (!storeId) return res.status(400).json({ error: "STORE_ID_REQUIRED" });

  const store = await prisma.store.findFirst({ where: { id: storeId, userId } });
  if (!store) return res.status(404).json({ error: "STORE_NOT_FOUND" });

  // 결제/정기 결제 로직은 별도 구현 필요. 여기서는 상태만 활성화.
  await prisma.user.update({
    where: { id: userId },
    data: { subscriptionStatus: "active" },
  });
  await prisma.store.update({
    where: { id: storeId },
    data: { autoReportEnabled: true },
  });

  return res.json({ ok: true, storeId, subscription: "active" });
});

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

// 광고 시청 보상: 기본 1토큰 적립 (watchOnly=true면 보상 없음)
router.post("/ad-reward", async (req, res) => {
  const userId = (req as any).user?.id;
  if (!userId) return res.status(401).json({ error: "UNAUTHORIZED" });
  const { allowExtra } = req.body as { allowExtra?: boolean };
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return res.status(404).json({ error: "USER_NOT_FOUND" });

  // 9AM KST 기준 하루 1회 기본 보상. allowExtra=true이면 추가 1회 허용.
  const now = new Date();
  const kstOffset = 9 * 60 * 60 * 1000;
  const kstNow = new Date(now.getTime() + kstOffset);
  const resetKst = new Date(kstNow);
  resetKst.setHours(9, 0, 0, 0);
  if (kstNow < resetKst) resetKst.setDate(resetKst.getDate() - 1);
  const resetUtc = new Date(resetKst.getTime() - kstOffset);

  // 기본 보상은 1회, 광고 시 추가 1회까지 허용 (총 2회/일)
  const alreadyClaimed = user.lastFreeTokenAt && user.lastFreeTokenAt >= resetUtc;
  const alreadyExtra = (user as any).lastFreeTokenExtraAt && (user as any).lastFreeTokenExtraAt >= resetUtc;
  if (!allowExtra && alreadyClaimed) {
    return res.status(429).json({
      error: "DAILY_LIMIT",
      message: "무료 토큰은 하루 1회만 수령할 수 있습니다. 광고 시 추가 1회를 사용할 수 있습니다.",
      resetAt: resetUtc
    });
  }
  if (allowExtra && alreadyExtra) {
    return res.status(429).json({
      error: "DAILY_LIMIT_EXTRA",
      message: "광고 보상은 하루 1회만 추가 가능합니다.",
      resetAt: resetUtc
    });
  }

  const targetField = allowExtra ? "lastFreeTokenExtraAt" : "lastFreeTokenAt";
  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      extraCredits: (user.extraCredits || 0) + 1,
      lastFreeTokenAt: allowExtra ? user.lastFreeTokenAt ?? now : now,
      // @ts-ignore
      [targetField]: now,
    },
  });

  return res.json({ ok: true, extraCredits: updated.extraCredits });
});

export default router;
