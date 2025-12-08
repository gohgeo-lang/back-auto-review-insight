/**
 * Google Maps 리뷰 수집 테스트 스크립트
 * 실행 예시:
 *   npx ts-node scripts/testGoogle.ts <place_id_or_cid> [storeId]
 *
 * place_id 예: ChIJ2UyX-KjzZTURW4e4OgN9S0A
 * cid 예: 0x35705bde553f2f8f:0x220afd42e4a2a6eb
 */
import { fetchGoogleReviews } from "../src/crawler/google";
import { prisma } from "../src/lib/prisma";

async function main() {
  const placeId = process.argv[2];
  const storeId = process.argv[3];
  if (!placeId) {
    console.error("❌ place_id 또는 cid를 입력하세요.");
    process.exit(1);
  }

  // 테스트용 유저 확보 (없으면 생성)
  const userId = process.env.TEST_USER_ID || "test-user";
  const email = `${userId}@example.com`;
  const user = await prisma.user.upsert({
    where: { id: userId },
    create: { id: userId, email, password: "dummy", subscriptionStatus: "free", subscriptionTier: "base" },
    update: {},
  });

  const headless = process.env.HEADLESS !== "false";
  const keepOpen = process.env.KEEP_OPEN === "true";
  console.log(
    `▶️ Google 리뷰 수집 시작: ${placeId} (userId=${user.id}, storeId=${storeId || "-"}, headless=${headless}, keepOpen=${keepOpen})`
  );

  const result = await fetchGoogleReviews(placeId, user.id, storeId, {
    maxReviews: 300,
    headless,
    keepOpen,
  });
  console.log("✅ 저장된 리뷰 수:", result.count);
  console.log("📝 로그:", result.logs);
}

main()
  .catch((err) => {
    console.error("❌ 에러:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
