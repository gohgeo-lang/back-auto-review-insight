import { Router } from "express";
import { extractPlaceId } from "../utils/naverPlace";
import { prisma } from "../lib/prisma";
import { fetchNaverReviews } from "../crawler/naver";
import { authMiddleware } from "../middleware/authMiddleware";
import axios from "axios";
import * as cheerio from "cheerio";

const router = Router();

// 인증 필요
router.use(authMiddleware);

// ⭐ 1) placeId 추출 API
router.post("/extract", (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: "URL_REQUIRED" });
  }

  const placeId = extractPlaceId(url);

  if (!placeId) {
    return res.status(400).json({ error: "INVALID_URL" });
  }

  return res.json({ placeId });
});

// ⭐ 2) 매장 등록 (수집은 별도 호출)
router.post("/register-store", async (req, res) => {
  const { placeId, name, url, autoCrawlEnabled, autoReportEnabled } = req.body;
  const userId = (req as any).user?.id;

  try {
    if (!placeId) {
      return res.status(400).json({ error: "PLACE_ID_REQUIRED" });
    }
    if (!userId) {
      return res.status(401).json({ error: "UNAUTHORIZED" });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: "USER_NOT_FOUND" });

    let finalName = name;
    // placeId를 이용해 네이버 페이지에서 상호명 자동 추출 (베스트Effort)
    if (!finalName) {
      try {
        const resp = await axios.get(`https://m.place.naver.com/restaurant/${placeId}/home`, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
          },
        });
        const $ = cheerio.load(resp.data);
        const rawTitle =
          $('meta[property="og:title"]').attr("content") ||
          $('meta[name="twitter:title"]').attr("content") ||
          $("title").text() ||
          "";
        const cleaned = rawTitle
          .replace(/\s*[:|]\s*네이버.*/i, "")
          .replace(/\s*-\s*네이버.*/i, "")
          .replace(/네이버\s*플레이스/i, "")
          .trim();
        if (cleaned) {
          finalName = cleaned;
        } else if (rawTitle) {
          finalName = rawTitle.trim();
        }
      } catch (err) {
        console.warn("[store] place name fetch failed", err);
      }
    }

    const store = await prisma.store.create({
      data: {
        userId,
        placeId,
        name: finalName,
        url,
        autoCrawlEnabled: autoCrawlEnabled !== false,
        autoReportEnabled: autoReportEnabled !== false,
      },
    });

    return res.json({
      ok: true,
      store,
      message: "Store saved. Run crawler separately to collect reviews.",
    });
  } catch (e) {
    console.error("[store/register-store] error:", e);
    return res.status(500).json({ error: "매장 등록 실패", detail: String(e) });
  }
});

// ⭐ 3) 매장 목록
router.get("/", async (req, res) => {
  const userId = (req as any).user?.id;
  if (!userId) return res.status(401).json({ error: "UNAUTHORIZED" });
  const stores = await prisma.store.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
  return res.json(stores);
});

// 설정 업데이트 (autoCrawl/autoReport)
router.post("/settings", async (req, res) => {
  const userId = (req as any).user?.id;
  const { storeId, autoCrawlEnabled, autoReportEnabled } = req.body;

  if (!userId) return res.status(401).json({ error: "UNAUTHORIZED" });
  if (!storeId) return res.status(400).json({ error: "STORE_ID_REQUIRED" });

  const store = await prisma.store.findFirst({ where: { id: storeId, userId } });
  if (!store) return res.status(404).json({ error: "STORE_NOT_FOUND" });

  const updated = await prisma.store.update({
    where: { id: storeId },
    data: {
      autoCrawlEnabled: autoCrawlEnabled ?? store.autoCrawlEnabled,
      autoReportEnabled: autoReportEnabled ?? store.autoReportEnabled,
    },
  });

  return res.json(updated);
});

// 매장 정보 수정 (name/url/placeId, auto flags)
router.put("/:id", async (req, res) => {
  const userId = (req as any).user?.id;
  const storeId = req.params.id;
  const { name, url, placeId, autoCrawlEnabled, autoReportEnabled } = req.body;

  if (!userId) return res.status(401).json({ error: "UNAUTHORIZED" });
  const store = await prisma.store.findFirst({ where: { id: storeId, userId } });
  if (!store) return res.status(404).json({ error: "STORE_NOT_FOUND" });

  const updated = await prisma.store.update({
    where: { id: storeId },
    data: {
      name: name ?? store.name,
      url: url ?? store.url,
      placeId: placeId ?? store.placeId,
      autoCrawlEnabled: autoCrawlEnabled ?? store.autoCrawlEnabled,
      autoReportEnabled: autoReportEnabled ?? store.autoReportEnabled,
    },
  });

  return res.json({ ok: true, store: updated });
});

// 매장 삭제 (연관 리뷰/요약/리포트/배치요약 포함)
router.delete("/:id", async (req, res) => {
  const userId = (req as any).user?.id;
  const storeId = req.params.id;
  if (!userId) return res.status(401).json({ error: "UNAUTHORIZED" });

  const store = await prisma.store.findFirst({ where: { id: storeId, userId } });
  if (!store) return res.status(404).json({ error: "STORE_NOT_FOUND" });

  // 리뷰 및 종속 엔티티 정리
  await prisma.summary.deleteMany({
    where: { review: { storeId, userId } },
  });
  await prisma.review.deleteMany({
    where: { storeId, userId },
  });
  await prisma.report.deleteMany({
    where: { storeId, userId },
  });
  await prisma.batchSummary.deleteMany({
    where: { storeId, userId },
  });
  await prisma.store.delete({ where: { id: storeId } });

  return res.json({ ok: true, deleted: storeId });
});

export default router;
